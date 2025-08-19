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
const ADMIN_API = process.env.ADMIN_API || (process.env.SERVER_ADMIN_URL || 'http://localhost:5000/api/admin');
const MAX_RETRIES = parseInt(process.env.MODEL_REG_RETRIES || '3', 10);
const RETRY_BASE_MS = parseInt(process.env.MODEL_REG_RETRY_BASE_MS || '500', 10);
const AUTO_ACTIVATE = (process.env.MODEL_AUTO_ACTIVATE || 'false').toLowerCase() === 'true';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || null;

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

/**
 * Helper: safe parse JSON-ish input (string or object)
 */
function normalizeMsg(rawValue) {
  if (!rawValue) return null;
  if (typeof rawValue === 'object') return rawValue;
  try {
    return JSON.parse(rawValue);
  } catch (e) {
    return null;
  }
}

/**
 * Extract registry payload and runId from either envelope or legacy message.
 * Returns { payload, runId, event, source } where payload is the object expected
 * to contain run_id, local_model_path, scaler_path, metrics, model_name, user_id etc.
 */
function extractRegistryPayload(msg) {
  if (!msg) return { payload: null, runId: null, event: null, source: null };

  // If it's an envelope
  if (msg.event_type && Object.prototype.hasOwnProperty.call(msg, 'payload')) {
    const payload = msg.payload || {};
    const runId = payload.run_id || payload.runId || msg.event_id || payload.run || null;
    return { payload, runId, event: msg, source: msg.source || null };
  }

  // Legacy: message itself is payload
  const runId = msg.run_id || msg.runId || msg.run || msg.runId || null;
  return { payload: msg, runId, event: msg, source: null };
}

/**
 * Post registry doc to Admin API to persist ModelRegistry.
 * If record already exists, admin API should handle upsert/duplicate gracefully.
 */
async function persistRegistryToAdmin(registryDoc) {
  try {
    const url = `${ADMIN_API.replace(/\/$/, '')}/models`;
    const res = await axios.post(url, registryDoc, { timeout: 10_000 });
    console.log('[model-reg-consumer] persisted registry to admin API', res.status);
    return res.data;
  } catch (e) {
    console.warn('[model-reg-consumer] failed to persist registry to admin API:', e.message || e);
    throw e;
  }
}

/**
 * Optionally call admin activate endpoint to mark this run as active for user/global
 */
async function activateRegistryRun(runId, userId = null) {
  if (!runId) return null;
  try {
    const url = `${ADMIN_API.replace(/\/$/, '')}/models/${encodeURIComponent(runId)}/activate`;
    const body = { user_id: userId || null };
    const res = await axios.post(url, body, { timeout: 10_000 });
    console.log('[model-reg-consumer] activated registry run via admin API', runId, 'user:', userId, 'status:', res.status);
    return res.data;
  } catch (e) {
    console.warn('[model-reg-consumer] failed to activate registry run via admin API:', e.message || e);
    throw e;
  }
}

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

      // parse JSON (but keep original raw for DLQ if needed)
      let parsed;
      try {
        parsed = normalizeMsg(raw);
        if (!parsed) throw new Error('invalid_json');
      } catch (err) {
        console.warn('[model-reg-consumer] invalid JSON -> DLQ', err.message || err);
        await forwardToDLQ(producer, raw, 'invalid_json', err.message || '');
        return;
      }

      // Optional envelope validation
      if (parsed && parsed.event_type && validateEnvelope) {
        const ok = validateEnvelope(parsed);
        if (!ok) {
          console.warn('[model-reg-consumer] envelope failed AJV validation -> DLQ', validateEnvelope.errors);
          await forwardToDLQ(producer, JSON.stringify(parsed), 'envelope_validation_failed', JSON.stringify(validateEnvelope.errors));
          return;
        }
      }

      // Extract payload & runId
      const { payload, runId, event, source } = extractRegistryPayload(parsed);
      if (!payload) {
        console.warn('[model-reg-consumer] no payload extracted -> DLQ');
        await forwardToDLQ(producer, raw, 'no_payload', '');
        return;
      }

      // Normalize expected fields in payload
      const modelName = payload.model_name || payload.modelName || payload.name || 'forecast';
      const resolvedRunId = runId || payload.run_id || payload.runId || payload.run || null;
      const localModelPath = payload.local_model_path || payload.local_model_path || payload.local_path || payload.localModelPath || payload.model_path || null;
      const scalerPath = payload.scaler_path || payload.scalerPath || payload.scaler_path || payload.scaler || null;
      const metrics = payload.metrics || {};
      const userId = payload.user_id || payload.userId || payload.user || null;
      const timestamp = payload.timestamp || new Date().toISOString();

      if (!resolvedRunId) {
        console.warn('[model-reg-consumer] registry payload missing run_id -> DLQ', JSON.stringify(payload).slice(0, 300));
        await forwardToDLQ(producer, JSON.stringify(payload), 'missing_run_id', '');
        return;
      }

      // Build registry document to persist
      const registryDoc = {
        run_id: String(resolvedRunId),
        model_name: modelName,
        user_id: userId || null,
        local_model_path: localModelPath || '',
        scaler_path: scalerPath || '',
        metrics: metrics || {},
        created_at: timestamp,
        active: false
      };

      // Persist registry to admin API (best-effort). If this fails, we continue — but we still try reload.
      try {
        await persistRegistryToAdmin(registryDoc);
      } catch (e) {
        // Persist failed — still attempt reload, but include warning in logs and add note for DLQ if needed later.
        console.warn('[model-reg-consumer] warning: failed to persist registry; continuing to reload step');
      }

      // Try to notify forecast service to reload model (retry transiently)
      let attempt = 0;
      let lastErr = null;
      while (attempt < MAX_RETRIES) {
        attempt++;
        try {
          console.log(`[model-reg-consumer] calling forecast service reload_model (run_id=${resolvedRunId}) attempt=${attempt}`);
          // POST to /reload_model with { run_id }
          const headers = {};
          if (INTERNAL_SECRET) headers['X-Internal-Secret'] = INTERNAL_SECRET;
          const res = await axios.post(
            `${FORECAST_SERVICE_URL.replace(/\/$/, '')}/reload_model`,
            { run_id: resolvedRunId },
            { timeout: 10_000, headers }
          );
          if (res && res.data && res.data.ok) {
            console.log('[model-reg-consumer] reload_model accepted, run_id=', resolvedRunId);
            // Optionally auto-activate this run for user/global if configured
            if (AUTO_ACTIVATE) {
              try {
                await activateRegistryRun(resolvedRunId, userId || null);
              } catch (actErr) {
                console.warn('[model-reg-consumer] failed to auto-activate run (non-fatal):', actErr.message || actErr);
              }
            }
            // Successful reload -> return (done)
            return;
          } else {
            // Not ok response — treat as failure
            lastErr = new Error(`reload_model returned non-ok: ${JSON.stringify(res.data)}`);
            console.warn('[model-reg-consumer] reload_model returned non-ok', res.data);
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

      // If we reached here, reload failed after retries -> send to DLQ with context
      console.error('[model-reg-consumer] reload_model failed after retries -> forwarding to DLQ', lastErr && lastErr.message);
      const dlqPayload = {
        original_event: event || parsed,
        extracted_payload: payload,
        error: lastErr && (lastErr.message || String(lastErr)),
        ts: new Date().toISOString()
      };
      await forwardToDLQ(producer, JSON.stringify(dlqPayload), 'reload_failed_after_retries', lastErr && (lastErr.stack || String(lastErr)));
    }
  });
}

/**
 * Forward raw message or JSON-stringified object to DLQ with reason and details.
 */
async function forwardToDLQ(producer, raw, reason, details) {
  try {
    const msg = (typeof raw === 'string') ? raw : JSON.stringify(raw);
    await producer.send({
      topic: DLQ_TOPIC,
      messages: [{ key: 'dlq', value: JSON.stringify({ raw: msg, reason, details, ts: new Date().toISOString() }) }]
    });
    console.log('[model-reg-consumer] forwarded message to DLQ reason=', reason);
  } catch (e) {
    console.warn('[model-reg-consumer] failed to forward to DLQ', e);
  }
}

module.exports = { startModelRegistryConsumer };
