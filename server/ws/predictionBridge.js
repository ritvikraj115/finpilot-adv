'use strict';
const { Kafka } = require('kafkajs');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const PRED_TOPIC = process.env.TOPIC_PREDICTIONS || 'finpilot.predictions';
const DLQ_TOPIC = process.env.TOPIC_DLQ || 'finpilot.dlq';
const GROUP = process.env.PRED_BRIDGE_GROUP || 'pred-bridge';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
let validateEnvelope = null;
try {
  const schemaPath = path.join(__dirname, '..', '..', 'schemas', 'prediction_envelope.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  validateEnvelope = ajv.compile(schema);
  console.log('[pred-bridge] loaded envelope schema for validation');
} catch (e) {
  console.warn('[pred-bridge] could not load envelope schema; envelope validation disabled:', e.message || e);
}

async function startPredictionBridge(io) {
  if (!io) throw new Error('predictionBridge requires io (socket.io) instance');
  if (process.env.USE_KAFKA === 'false') {
    console.log('[pred-bridge] USE_KAFKA=false -> not starting bridge (dev mode)');
    return null;
  }

  const kafka = new Kafka({ clientId: 'pred-bridge', brokers: KAFKA_BROKERS });
  const consumer = kafka.consumer({ groupId: GROUP });
  const producer = kafka.producer();

  await consumer.connect();
  await producer.connect();
  await consumer.subscribe({ topic: PRED_TOPIC, fromBeginning: false });
  console.log('[pred-bridge] connected and subscribed to', PRED_TOPIC);

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const raw = message.value?.toString?.() ?? null;
      if (!raw) return;

      let msg;
      try {
        msg = JSON.parse(raw);
      } catch (err) {
        console.warn('[pred-bridge] invalid JSON -> forwarding to DLQ', err.message || err);
        await forwardToDLQ(producer, raw, 'invalid_json', err.message);
        return;
      }

      // If it looks like an envelope (has event_type and payload), validate schema
      if (msg && (msg.event_type && msg.payload)) {
        if (validateEnvelope) {
          const valid = validateEnvelope(msg);
          if (!valid) {
            console.warn('[pred-bridge] envelope failed validation -> forwarding to DLQ', validateEnvelope.errors);
            await forwardToDLQ(producer, JSON.stringify(msg), 'envelope_validation_failed', JSON.stringify(validateEnvelope.errors));
            return;
          }
        }
        // Use envelope values
        routeByEventType(io, msg.event_type, msg.user_id, msg.payload, msg);
        return;
      }

      // Legacy/compat path: infer type from fields
      const inferred = inferTypeAndPayload(msg);
      if (!inferred) {
        console.warn('[pred-bridge] could not infer message type, forwarding to DLQ');
        await forwardToDLQ(producer, JSON.stringify(msg), 'type_inference_failed', '');
        return;
      }
      routeByEventType(io, inferred.type, inferred.user_id, inferred.payload, msg);
    }
  });

  // graceful shutdown
  const stop = async () => {
    try { await consumer.disconnect(); } catch (e) { /* ignore */ }
    try { await producer.disconnect(); } catch (e) { /* ignore */ }
    console.log('[pred-bridge] stopped');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  return { consumer, stop };
}

function routeByEventType(io, eventType, userId, payload, rawMsg) {
  const room = `user:${userId || 'anon'}`;
  try {
    if (eventType === 'forecast') {
      io.to(room).emit('forecast.prediction', { metadata: rawMsg, payload });
      console.log(`[pred-bridge] emitted forecast.prediction to ${room}`);
    } else if (eventType === 'classification') {
      io.to(room).emit('prediction', { metadata: rawMsg, payload });
      console.log(`[pred-bridge] emitted prediction to ${room}`);
    } else if (eventType === 'model.registry') {
      // optional: emit model registry events if front-end subscribes
      io.to(room).emit('model.registry', { metadata: rawMsg, payload });
      console.log(`[pred-bridge] emitted model.registry to ${room}`);
    } else {
      // fallback
      io.to(room).emit('prediction', { metadata: rawMsg, payload });
      console.log(`[pred-bridge] emitted fallback prediction to ${room}`);
    }
  } catch (e) {
    console.warn('[pred-bridge] emit failed', e);
  }
}

async function forwardToDLQ(producer, raw, reason, details) {
  try {
    await producer.send({
      topic: DLQ_TOPIC,
      messages: [{ key: 'dlq', value: JSON.stringify({ raw, reason, details, ts: new Date().toISOString() }) }]
    });
    console.log('[pred-bridge] forwarded message to DLQ reason=', reason);
  } catch (e) {
    console.warn('[pred-bridge] failed to publish to DLQ', e);
  }
}

function inferTypeAndPayload(msg) {
  if (!msg || typeof msg !== 'object') return null;
  // classification candidates
  if (msg.transaction_id || msg.predicted_category || msg.confidence !== undefined) {
    return { type: 'classification', user_id: msg.user_id || msg.userId || null, payload: msg };
  }
  // forecast candidates
  if (msg.daywise || msg.horizon || msg.forecast !== undefined || msg.total !== undefined) {
    return { type: 'forecast', user_id: msg.user_id || msg.userId || null, payload: msg };
  }
  // some producers may wrap original payload under payload field (legacy)
  if (msg.payload && typeof msg.payload === 'object') {
    if (msg.payload.transaction_id) {
      return { type: 'classification', user_id: msg.payload.user_id || msg.payload.userId || null, payload: msg.payload };
    }
    if (msg.payload.daywise) {
      return { type: 'forecast', user_id: msg.payload.user_id || msg.payload.userId || null, payload: msg.payload };
    }
  }
  // not inferrable
  return null;
}

module.exports = { startPredictionBridge };

