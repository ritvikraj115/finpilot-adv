'use strict';

const { Kafka } = require('kafkajs');
const { v4: uuidv4 } = require('uuid');

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const PRED_TOPIC = process.env.TOPIC_PREDICTIONS || 'finpilot.predictions';
const DLQ_TOPIC = process.env.TOPIC_DLQ || 'finpilot.dlq';

const kafka = new Kafka({ clientId: 'finpilot-publisher', brokers: KAFKA_BROKERS });
const producer = kafka.producer();

let started = false;

async function startPredProducer() {
  if (process.env.USE_KAFKA === 'false') {
    console.log('[pred-pub] USE_KAFKA=false -> mock mode');
    started = false;
    return;
  }
  if (started) return;
  await producer.connect();
  started = true;
  console.log('[pred-pub] connected producer for predictions');
}

/**
 * Build canonical envelope if payload is raw (no envelope fields).
 * If caller already passed an envelope with event_type and payload, pass-through.
 */
function makeEnvelope(maybePayload, opts = {}) {
  // If looks like an envelope already, return as-is
  if (maybePayload && typeof maybePayload === 'object' && maybePayload.event_type && Object.prototype.hasOwnProperty.call(maybePayload, 'payload')) {
    return maybePayload;
  }

  const inferredEventType = opts.event_type || (maybePayload && (maybePayload.daywise || maybePayload.horizon) ? 'forecast' : 'classification');
  const source = opts.source || (inferredEventType === 'forecast' ? 'forecast-service' : 'transactions-service');

  return {
    version: 'v1',
    event_type: inferredEventType,
    source,
    event_id: opts.event_id || (maybePayload && (maybePayload.transaction_id || maybePayload.event_id)) || uuidv4(),
    user_id: opts.user_id || (maybePayload && (maybePayload.user_id || maybePayload.userId)) || null,
    timestamp: new Date().toISOString(),
    model_run_id: opts.model_run_id || (maybePayload && maybePayload.model_run_id) || null,
    payload: maybePayload || {}
  };
}

/**
 * Publish a message. `topic` optional (defaults to TOPIC_PREDICTIONS).
 * `payload` can be either:
 *  - envelope ({ event_type, payload, ... }) — will be passed through
 *  - raw payload (forecast obj or classification obj) — will be wrapped into envelope
 * `key` is Kafka message key (recommended: user_id)
 */
async function publishPrediction(topic = PRED_TOPIC, payload = {}, key = null, opts = {}) {
  if (process.env.USE_KAFKA === 'false') {
    console.log('[pred-pub][mock] publishPrediction', topic, key, payload);
    return;
  }

  if (!started) {
    await startPredProducer();
  }

  const envelope = makeEnvelope(payload, opts);
  const msgKey = key || (envelope.user_id ? String(envelope.user_id) : envelope.event_id);

  try {
    await producer.send({
      topic,
      messages: [{ key: msgKey, value: JSON.stringify(envelope) }],
      acks: -1
    });
    console.log(`[pred-pub] published to ${topic} key=${msgKey} event_type=${envelope.event_type} event_id=${envelope.event_id}`);
  } catch (err) {
    console.error('[pred-pub] failed to publish message', err && err.message ? err.message : err);
    // Optional: write to DLQ (best-effort)
    try {
      await producer.send({ topic: DLQ_TOPIC, messages: [{ key: msgKey, value: JSON.stringify({ failed_publish: envelope, error: String(err) }) }] });
      console.log('[pred-pub] wrote failed publish to DLQ');
    } catch (dlqErr) {
      console.warn('[pred-pub] failed to write to DLQ', dlqErr);
    }
    throw err;
  }
}

async function disconnectPredProducer() {
  if (!started) return;
  try { await producer.disconnect(); } catch(e) { /* ignore */ }
  started = false;
  console.log('[pred-pub] producer disconnected');
}

module.exports = {
  startPredProducer,
  publishPrediction,
  disconnectPredProducer,
  DEFAULT_TOPIC: PRED_TOPIC
};
