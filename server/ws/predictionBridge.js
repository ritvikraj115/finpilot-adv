// server/ws/predictionBridge.js
'use strict';
const { Kafka } = require('kafkajs');

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const PRED_TOPIC = process.env.TOPIC_PREDICTIONS || 'finpilot.predictions';
const GROUP = process.env.PRED_BRIDGE_GROUP || 'pred-bridge';

async function startPredictionBridge(io) {
  // io is the socket.io server instance from your main server
  if (!io) throw new Error('predictionBridge requires io instance');

  if (process.env.USE_KAFKA === 'false') {
    console.log('[pred-bridge] USE_KAFKA=false -> not starting bridge (dev mode)');
    return;
  }

  const kafka = new Kafka({ clientId: 'pred-bridge', brokers: KAFKA_BROKERS });
  const consumer = kafka.consumer({ groupId: GROUP });
  await consumer.connect();
  await consumer.subscribe({ topic: PRED_TOPIC, fromBeginning: false });
  console.log('[pred-bridge] connected and subscribed to', PRED_TOPIC);

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const payload = JSON.parse(message.value.toString());
        const userId = String(payload.user_id || payload.userId || 'anon');

        // Broadcast to a room per user id for minimal noise
        io.to(`user:${userId}`).emit('prediction', payload);
        console.log('[pred-bridge] emitted prediction to user room', userId);
      } catch (err) {
        console.warn('[pred-bridge] failed to emit message:', err.message || err);
      }
    }
  });
}

module.exports = { startPredictionBridge };
