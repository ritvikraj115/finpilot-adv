// server/consumers/dlq_saver.js
'use strict';
const { Kafka } = require('kafkajs');
const mongoose = require('mongoose');
const DLQMessage = require('../models/DLQMessage');

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const DLQ_TOPIC = process.env.TOPIC_DLQ || 'finpilot.dlq';
const GROUP_ID = process.env.DLQ_SAVER_GROUP || 'dlq-saver-group';

async function startDlqSaver() {
  if (process.env.USE_KAFKA === 'false') {
    console.log('[dlq-saver] USE_KAFKA=false -> not starting');
    return;
  }

  // ensure mongoose is connected (server likely did it; but safe to ensure)
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  }

  const kafka = new Kafka({ clientId: 'dlq-saver', brokers: KAFKA_BROKERS });
  const consumer = kafka.consumer({ groupId: GROUP_ID });
  await consumer.connect();
  await consumer.subscribe({ topic: DLQ_TOPIC, fromBeginning: true });
  console.log('[dlq-saver] subscribed to', DLQ_TOPIC);

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const raw = message.value.toString();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        parsed = raw;
      }
      const doc = {
        topic,
        partition,
        offset: message.offset,
        key: message.key ? message.key.toString() : null,
        value: parsed,
        error: parsed && parsed.error ? parsed.error : undefined,
        received_at: new Date()
      };
      try {
        const saved = await DLQMessage.create(doc);
        console.log('[dlq-saver] saved DLQ message id=', saved._id.toString());
      } catch (err) {
        console.error('[dlq-saver] failed to save DLQ message:', err.message || err);
      }
    }
  });
}

if (require.main === module) {
  startDlqSaver().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { startDlqSaver };
