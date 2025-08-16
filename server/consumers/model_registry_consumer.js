// server/consumers/model_registry_consumer.js
'use strict';
const { Kafka } = require('kafkajs');
const axios = require('axios');
const ModelRegistry = require('../models/ModelRegistry');

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const TOPIC = process.env.TOPIC_MODEL_REGISTRY || 'finpilot.model.registry';
const GROUP = process.env.MODEL_REGISTRY_GROUP || 'model-registry-group';
const FORECAST_SERVICE_URL = process.env.FORECAST_SERVICE_URL || 'http://localhost:8000';

async function startRegistryConsumer() {
  if (process.env.USE_KAFKA === 'false') return;
  const kafka = new Kafka({ clientId: 'model-reg-consumer', brokers: KAFKA_BROKERS });
  const consumer = kafka.consumer({ groupId: GROUP });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
  console.log('[model-reg] subscribed to', TOPIC);

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const payload = JSON.parse(message.value.toString());
        const { model_name, run_id, local_model_path, scaler_path, metrics } = payload;
        await ModelRegistry.findOneAndUpdate(
          { model_name },
          { run_id, local_model_path, scaler_path, metrics, created_at: new Date(), metadata: payload },
          { upsert: true }
        );
        console.log('[model-reg] upserted', model_name, run_id);

        // Notify forecast service to reload model (safe HTTP call)
        try {
          await axios.post(`${FORECAST_SERVICE_URL}/reload_model`, { run_id }, { timeout: 5000 });
          console.log('[model-reg] asked forecast service to reload');
        } catch (err) {
          console.warn('[model-reg] failed to notify forecast service to reload:', err.message || err);
        }
      } catch (err) {
        console.error('[model-reg] error processing message:', err);
      }
    }
  });
}

if (require.main === module) {
  startRegistryConsumer().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { startRegistryConsumer };
