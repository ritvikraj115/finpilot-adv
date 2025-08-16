// server/kafka/publisherPredictions.js
'use strict';
const { Kafka } = require('kafkajs');

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const PRED_TOPIC = process.env.TOPIC_PREDICTIONS || 'finpilot.predictions';

const kafka = new Kafka({ clientId: 'finpilot-publisher', brokers: KAFKA_BROKERS });
const producer = kafka.producer();
let started = false;

async function startPredProducer() {
  if (process.env.USE_KAFKA === 'false') {
    console.log('[pred-pub] USE_KAFKA=false -> mock mode');
    started = false;
    return;
  }
  await producer.connect();
  started = true;
  console.log('[pred-pub] connected producer for predictions');
}

async function publishPrediction(payload) {
  if (process.env.USE_KAFKA === 'false') {
    console.log('[pred-pub][mock] publishPrediction', payload.transaction_id);
    return;
  }
  if (!started) {
    // try starting (useful when this module used standalone)
    await startPredProducer();
  }
  await producer.send({
    topic: PRED_TOPIC,
    messages: [{ key: String(payload.user_id || 'anon'), value: JSON.stringify(payload) }],
    acks: -1
  });
}

async function disconnectPredProducer() {
  try { await producer.disconnect(); } catch(e){/*ignore*/ }
}

module.exports = { startPredProducer, publishPrediction, disconnectPredProducer };
