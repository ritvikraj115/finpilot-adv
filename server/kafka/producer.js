// server/kafka/producer.js
const { Kafka } = require('kafkajs');

const KAFKA_BROKERS = process.env.KAFKA_BROKERS ? process.env.KAFKA_BROKERS.split(',') : ['localhost:9092'];
const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID || 'finpilot-api-producer';
const TOPIC_TRANSACTIONS = process.env.TOPIC_TRANSACTIONS || 'finpilot.transactions';

let producer;
let connected = false;

async function startProducer() {
  if (process.env.USE_KAFKA === 'false') {
    console.log('[kafka] USE_KAFKA=false -> running in mock mode (no broker connect)');
    return;
  }
  const kafka = new Kafka({ clientId: KAFKA_CLIENT_ID, brokers: KAFKA_BROKERS });
  producer = kafka.producer({ allowAutoTopicCreation: true });
  await producer.connect();
  connected = true;
  console.log('[kafka] producer connected to', KAFKA_BROKERS);
}

async function publishTransaction(tx) {
  if (process.env.USE_KAFKA === 'false') {
    // Mock mode: simply log and "resolve"
    console.log('[kafka][mock] publishTransaction', tx.transaction_id || tx.id || '(no id)');
    return { success: true, mock: true };
  }
  if (!producer || !connected) {
    throw new Error('Kafka producer not connected. Call startProducer() first.');
  }
  const key = String(tx.user_id || tx.userId || 'anon');
  const messageValue = JSON.stringify(tx);
  await producer.send({
    topic: TOPIC_TRANSACTIONS,
    messages: [{ key, value: messageValue }],
    acks: -1, // wait for all replicas (dev: fine; in prod tune)
  });
  return { success: true };
}

async function disconnectProducer() {
  if (producer && connected) {
    await producer.disconnect();
    connected = false;
  }
}

module.exports = { startProducer, publishTransaction, disconnectProducer, TOPIC_TRANSACTIONS };
