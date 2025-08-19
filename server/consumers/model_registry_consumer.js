'use strict';

const { Kafka } = require('kafkajs');
const axios = require('axios');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TOPIC = process.env.TOPIC_MODEL_REGISTRY || 'finpilot.model.registry';
const DLQ_TOPIC = process.env.TOPIC_DLQ || 'finpilot.dlq';
const GROUP_ID = process.env.MODEL_REGISTRY_GROUP || 'model-registry-consumers';
const FORECAST_SERVICE_URL = process.env.FORECAST_SERVICE_URL || 'http://localhost:8000';
const MAX_RETRIES = parseInt(process.env.MODEL_REG_RETRIES || '3', 10);
const RETRY_BASE_MS = parseInt(process.env.MODEL_REG_RETRY_BASE_MS || '500', 10);

// AJV schema load (optional). Use the same envelope schema if present.
const ajv = new Ajv({ allErrors: true, coerceTypes: true });
addFormats(ajv);
let validateEnvelope = null;
try {
  const schemaPath = path.join(__dirname, '..', '..', 'schemas', 'prediction_envelope.schema.json');
  if (fs.existsSync(schemaPath)) {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    validateEnvelope = ajv.compile(schema);
    console.log('[model-reg-consumer] loaded envelope schema for validation');
  } else {
    console.log('[model-reg-consumer] no envelope schema found; skipping AJV validation');
  }
} catch (e) {
  console.warn('[model-reg-consumer] failed to load envelope schema:', e.message || e);
  validateEnvelope = null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startModelRegistryConsumer() {
  if (process.env.USE_KAFKA === 'false') {
    console.log('[model-reg-consumer] USE_KAFKA=false -> not starting (dev mode)');
    return;
  }

  const kafka = new Kafka({ clientId: 'model-reg-consumer', brokers: KAFKA_BROKERS });
  const consumer = kafka.consumer({ groupId: GROUP_ID });
  const producer = kafka.producer(); // used to send to DLQ if needed

  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
  console.log('[model-reg-consumer] subscribed to', TOPIC);

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const raw = message.value?.toString?.();
      if (!raw) {
        console.warn('[model-reg-consumer] empty message; skipping');
        return;
      }

      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (err) {
        console.warn('[model-reg-consumer] invalid JSON -> DLQ', err.message || err);
        await forwardToDLQ(producer, raw, 'invalid_json', err.message);
        return;
      }

      // If it's an envelope-like message, optionally validate
      let runId = null;
      let payload = null;
      if (msg && msg.event_type && msg.payload) {
        if (validateEnvelope) {
          const ok = validateEnvelope(msg);
          if (!ok) {
            console.warn('[model-reg-consumer] envelope validation failed -> DLQ', validateEnvelope.errors);
            await forwardToDLQ(producer, JSON.stringify(msg), 'envelope_validation_failed', JSON.stringify(validateEnvelope.errors));
            return;
          }
        }
        // envelope format
        payload = msg.payload;
        runId = msg.payload && (msg.payload.run_id || msg.payload.runId || msg.run_id || msg.event_id);
      } else {
        // legacy / raw object
        payload = msg;
        runId = msg.run_id || msg.runId || msg.runId || msg.run || null;
      }

      if (!payload) {
        console.warn('[model-reg-consumer] no payload extracted -> DLQ');
        await forwardToDLQ(producer, raw, 'no_payload', '');
        return;
      }

      // Basic required fields check for model registry
      if (!payload.run_id && !payload.runId && !payload.run) {
        console.warn('[model-reg-consumer] registry message missing run_id -> DLQ', JSON.stringify(payload).slice(0,200));
        await forwardToDLQ(producer, JSON.stringify(payload), 'missing_run_id', '');
        return;
      }
      runId = runId || payload.run_id || payload.runId || payload.run;

      // Try to notify forecast service to reload model (retry transiently)
      let attempt = 0;
      let lastErr = null;
      while (attempt < MAX_RETRIES) {
        attempt++;
        try {
          console.log(`[model-reg-consumer] calling forecast service reload_model (run_id=${runId}) attempt=${attempt}`);
          // POST to /reload_model with { run_id }
          const res = await axios.post(`${FORECAST_SERVICE_URL.replace(/\/$/, '')}/reload_model`, { run_id: runId }, { timeout: 10_000 });
          if (res && res.data && res.data.ok) {
            console.log('[model-reg-consumer] reload_model accepted, run_id=', runId);
            // Optionally emit an event to predictions topic / socket (not implemented here)
            return;
          } else {
            // Not ok response — treat as failure
            lastErr = new Error(`reload_model returned non-ok: ${JSON.stringify(res.data)}`);
            console.warn('[model-reg-consumer] reload_model non-ok', res.data);
            // continue to retry
          }
        } catch (e) {
          lastErr = e;
          console.warn('[model-reg-consumer] reload_model call failed (transient?)', e.message || e);
          // backoff
          const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
          await sleep(delay);
          continue;
        }
      }

      // If we reached here, reload failed after retries -> send to DLQ
      console.error('[model-reg-consumer] reload_model failed after retries -> forwarding to DLQ', lastErr && lastErr.message);
      await forwardToDLQ(producer, JSON.stringify({ payload, error: lastErr && lastErr.message }), 'reload_failed_after_retries', lastErr && lastErr.stack ? lastErr.stack : String(lastErr));
    }
  });
}

async function forwardToDLQ(producer, raw, reason, details) {
  try {
    await producer.send({
      topic: DLQ_TOPIC,
      messages: [{ key: 'dlq', value: JSON.stringify({ raw, reason, details, ts: new Date().toISOString() }) }]
    });
    console.log('[model-reg-consumer] forwarded message to DLQ reason=', reason);
  } catch (e) {
    console.warn('[model-reg-consumer] failed to forward to DLQ', e);
  }
}

module.exports = { startModelRegistryConsumer };
