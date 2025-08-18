// server/consumers/transactions_consumer.js
'use strict';
const path = require('path');
const fs = require('fs');
const { Kafka } = require('kafkajs');
const axios = require('axios');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const Transaction = require('../models/Transaction');
const Planner = require('../models/Planner');
// use your shared AI client wrapper (implement Google / Gemini inside lib/ai-client)
const ai = new GoogleGenAI({ apiKey: 'AIzaSyD3nh3x80zD_z4mPMD0X1rgtalOGPJN7SM' });
const { publishPrediction } = require('../kafka/publisherPredictions');

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const GROUP_ID = process.env.KAFKA_CONSUMER_GROUP || 'transactions-workers';
const TOPIC = process.env.TOPIC_TRANSACTIONS || 'finpilot.transactions';
const DLQ_TOPIC = process.env.TOPIC_DLQ || 'finpilot.dlq';
const MAX_RETRIES = parseInt(process.env.CONSUMER_MAX_RETRIES || '3', 10);
const RETRY_BASE_MS = parseInt(process.env.RETRY_BASE_MS || '500', 10);
const MLSERVICE_URL = process.env.MLSERVICE_URL || 'http://localhost:8000';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- AJV schema validation setup ----------
const ajv = new Ajv({ allErrors: true, coerceTypes: true, useDefaults: true });
addFormats(ajv);
let validate;
try {
  const schemaPath = path.join(__dirname, '..', '..', 'schemas', 'transaction.schema.json');
  const schemaRaw = fs.readFileSync(schemaPath, 'utf8');
  const schema = JSON.parse(schemaRaw);
  validate = ajv.compile(schema);
  console.log('[consumer] loaded validation schema from', schemaPath);
} catch (err) {
  console.warn('[consumer] could not load schema, schema validation disabled:', err.message);
  validate = null;
}

// ---------- Consumer ----------
async function startConsumer() {
  if (process.env.USE_KAFKA === 'false') {
    console.log('[consumer] USE_KAFKA=false -> consumer will not start (dev mode)');
    return;
  }

  const kafka = new Kafka({ clientId: 'finpilot-consumer', brokers: KAFKA_BROKERS });
  const consumer = kafka.consumer({ groupId: GROUP_ID });
  const producer = kafka.producer(); // used for DLQ publishing if needed

  await consumer.connect();
  await producer.connect();
  console.log('[consumer] connected to kafka brokers', KAFKA_BROKERS);

  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
  console.log('[consumer] subscribed to', TOPIC);

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const raw = message.value.toString();
      let event;
      try {
        event = JSON.parse(raw);
      } catch (err) {
        console.error('[consumer] Invalid JSON message -> sending to DLQ', err.message || err);
        await sendToDLQ(producer, raw, 'invalid_json', err.message);
        return;
      }

      // Validate against schema if available
      if (validate) {
        const isValid = validate(event);
        if (!isValid) {
          console.warn('[consumer] schema validation failed:', validate.errors);
          const payload = {
            original_event: event,
            error: 'schema_validation_failed',
            details: validate.errors,
            failed_at: new Date().toISOString()
          };
          await sendToDLQ(producer, payload, 'schema_validation_failed', 'schema validation errors');
          return;
        }
      }

      const { transaction_id, user_id, description, amount, currency, timestamp } = event;
      if (!transaction_id) {
        console.warn('[consumer] event missing transaction_id; sending to DLQ');
        await sendToDLQ(producer, { original_event: event }, 'missing_transaction_id', 'transaction_id required');
        return;
      }

      // Processing with retry/backoff for transient failures
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          // Idempotency: try to create a new doc; if it already exists, fetch existing
          let createdDoc = null;
          try {
            createdDoc = await Transaction.create({
              transaction_id,
              userId: user_id,
              description,
              merchant_name: event.merchant_name || null,
              raw_payload: event,
              amount,
              currency: currency || 'INR',
              date: timestamp ? new Date(timestamp) : new Date(),
              ingest_status: 'processing',
              attempts: 0
            });
            console.log('[consumer] inserted new transaction', transaction_id);
          } catch (createErr) {
            if (createErr && createErr.code === 11000) {
              // duplicate key - fetch existing
              const existing = await Transaction.findOne({ transaction_id });
              if (existing && existing.ingest_status === 'processed') {
                console.log('[consumer] already processed, skipping', transaction_id);
                return; // idempotent skip
              }
              createdDoc = existing;
              console.log('[consumer] duplicate tx found, will update existing', transaction_id);
            } else {
              throw createErr;
            }
          }

          // 1) Call ML predict (if available)
          let category = null, confidence = null, model_run_id = null;
          try {
            const resp = await axios.post(`${MLSERVICE_URL}/predict`, { description });
            category = resp.data.category ?? null;
            confidence = resp.data.confidence ?? null;
            model_run_id = resp.data.model_run_id ?? null;
            console.log(`[consumer] ML predicted category=${category} confidence=${confidence}`);
          } catch (mlErr) {
            console.warn('[consumer] ML predict failed (will retry if transient):', mlErr.message || mlErr);
            throw mlErr; // trigger retry/backoff flow
          }

          // 2) Update/Upsert transaction as processed
          const explanation = []; // placeholder for SHAP/explainability
          const update = {
            $set: {
              ingest_status: 'processed',
              processed_at: new Date(),
              predicted_category: category,
              confidence,
              model_run_id,
              explanation,
              attempts: (createdDoc && createdDoc.attempts ? createdDoc.attempts : 0)
            }
          };
          await Transaction.updateOne({ transaction_id }, update, { upsert: true });
          console.log('[consumer] transaction updated processed:', transaction_id);

          // 3) Planner matching (AI/Gemini) — best-effort; non-fatal
          try {
            const txnDate = timestamp ? new Date(timestamp) : new Date();
            const monthKey = `${txnDate.getFullYear()}-${String(txnDate.getMonth() + 1).padStart(2, '0')}`;
            const planner = await Planner.findOne({ userId: user_id, month: monthKey });
            if (planner && Array.isArray(planner.futureExpenses) && planner.futureExpenses.length > 0) {
              const plannedList = planner.futureExpenses.map(fe => fe.description);
              const prompt = `
You are an expense-matching assistant.
User's planned expenses: ${JSON.stringify(plannedList)}.
New transaction description: "${description}".
Respond with a JSON array of exactly those planned descriptions
that this transaction fulfills. If none match, respond with [].
              `.trim();

              let matches = [];
              try {
                const geminiResponse = await ai.models.generateContent({
                  model: process.env.AI_MODEL || "gemini-2.0-flash",
                  contents: prompt
                });
                const content = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text
                  || geminiResponse?.data?.choices?.[0]?.message?.content
                  || '[]';
                matches = JSON.parse(content);
              } catch (gErr) {
                console.warn('[consumer] AI/Gemini matching failed (non-fatal):', gErr.message || gErr);
                matches = [];
              }
              if (Array.isArray(matches) && matches.length > 0) {
                planner.futureExpenses = planner.futureExpenses.filter(fe => !matches.includes(fe.description));
                await planner.save();
                console.log('[consumer] planner updated, removed matches:', matches);
              }
            }
          } catch (plannerErr) {
            console.warn('[consumer] planner update failed (non-fatal):', plannerErr.message || plannerErr);
          }

          // 4) Publish classification prediction event for downstream services / UI
          try {
            const rawPayload = {
              transaction_id,
              predicted_category: category,
              confidence,
              amount,
              currency
            };
            const topic = process.env.TOPIC_PREDICTIONS || 'finpilot.predictions';
            const key = user_id ? String(user_id) : String(transaction_id);
            // opts helps makeEnvelope infer source/model_run_id etc.
            const opts = { event_type: 'classification', source: 'transactions-consumer', event_id: transaction_id, user_id, model_run_id };
            await publishPrediction(topic, rawPayload, key, opts);
            console.log('[consumer] published classification prediction event for', transaction_id, '-> topic=', topic);
          } catch (pubErr) {
            console.warn('[consumer] publishPrediction failed (non-fatal):', pubErr.message || pubErr);
          }


          // Success -> break retry loop
          return;
        } catch (err) {
          const isLast = attempt === MAX_RETRIES;
          console.error(`[consumer] processing failed for ${transaction_id} attempt ${attempt}/${MAX_RETRIES}:`, err.message || err);

          // increment attempts counter in DB for visibility
          try {
            await Transaction.updateOne(
              { transaction_id },
              { $inc: { attempts: 1 }, $set: { last_error: (err.message || String(err)).slice(0, 1000) } },
              { upsert: true }
            );
          } catch (incErr) {
            console.warn('[consumer] failed to increment attempts', incErr.message || incErr);
          }

          if (isLast) {
            // send to DLQ with metadata
            try {
              const payload = {
                original_event: event,
                error: err.message || String(err),
                failed_at: new Date().toISOString(),
                attempts: attempt
              };
              await producer.send({ topic: DLQ_TOPIC, messages: [{ key: String(user_id || 'anon'), value: JSON.stringify(payload) }] });
              console.error('[consumer] sent message to DLQ', DLQ_TOPIC, transaction_id);
            } catch (dlqErr) {
              console.error('[consumer] failed to publish to DLQ', dlqErr.message || dlqErr);
            }
            return;
          }

          // backoff then retry
          const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
          console.log(`[consumer] retrying ${transaction_id} in ${delay}ms`);
          await sleep(delay);
          continue;
        }
      } // retry loop
    }
  });
}

// helper DLQ function (producer passed in)
async function sendToDLQ(producer, rawMsg, errorType, errorMsg) {
  try {
    const payload = { original_message: rawMsg, errorType, errorMsg, ts: new Date().toISOString() };
    await producer.send({ topic: DLQ_TOPIC, messages: [{ key: 'dlq', value: JSON.stringify(payload) }] });
    console.log('[consumer] message sent to DLQ');
  } catch (err) {
    console.error('[consumer] failed to write DLQ:', err.message || err);
  }
}

startConsumer().catch(err => {
  console.error('consumer fatal error', err);
  process.exit(1);
});

