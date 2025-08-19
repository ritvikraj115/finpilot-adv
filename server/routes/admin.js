// server/routes/admin.js
const express = require('express');
const router = express.Router();
const DLQMessage = require('../models/DLQMessage');
const { publishTransaction } = require('../kafka/producer'); // re-use existing producer for retries

// NOTE: This endpoint is NOT authenticated here — in your repo protect it behind admin auth in prod.

router.get('/dlq', async (req, res, next) => {
  try {
    const q = {};
    const items = await DLQMessage.find(q).sort({ received_at: -1 }).limit(200);
    res.json(items);
  } catch (err) { next(err); }
});

router.get('/dlq/:id', async (req, res, next) => {
  try {
    const item = await DLQMessage.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    res.json(item);
  } catch (err) { next(err); }
});

// Retry a DLQ item by republishing its original event back to transactions topic.
// This increments retry_count and sets retried_at.
router.post('/dlq/:id/retry', async (req, res, next) => {
  try {
    const item = await DLQMessage.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });

    // original event is in item.value.original_event OR item.value
    const payload = item.value && item.value.original_event ? item.value.original_event : item.value;
    if (!payload) return res.status(400).json({ error: 'no original event to retry' });

    // republish using publishTransaction (works in mock mode or real Kafka)
    await publishTransaction(payload);

    item.retry_count = (item.retry_count || 0) + 1;
    item.retried_at = new Date();
    item.retry_status = 'retried';
    await item.save();

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Optionally delete DLQ item
router.delete('/dlq/:id', async (req, res, next) => {
  try {
    await DLQMessage.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// create
router.post('/models', async (req, res) => {
  try {
    const doc = await ModelRegistry.create(req.body);
    return res.status(201).json(doc);
  } catch (e) {
    console.error('admin: failed to create model registry', e);
    return res.status(500).json({ error: String(e) });
  }
});

// list/filter
router.get('/models', async (req, res) => {
  const q = {};
  if (req.query.model_name) q.model_name = req.query.model_name;
  if (req.query.user_id) q.user_id = req.query.user_id;
  const docs = await ModelRegistry.find(q).sort({ created_at: -1 }).limit(200);
  return res.json(docs);
});

// activate
router.post('/models/:run_id/activate', async (req, res) => {
  const { run_id } = req.params;
  const { user_id } = req.body; // may be null => global
  try {
    // deactivate previous for that user+model_name
    const doc = await ModelRegistry.findOne({ run_id });
    if (!doc) return res.status(404).json({ error: 'not found' });
    await ModelRegistry.updateMany({ model_name: doc.model_name, user_id: user_id || null }, { active: false });
    doc.active = true; doc.user_id = user_id || null;
    await doc.save();
    return res.json(doc);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// get active
router.get('/models/active', async (req, res) => {
  const { model_name, user_id } = req.query;
  // prefer user-specific
  let doc = null;
  if (user_id) {
    doc = await ModelRegistry.findOne({ model_name, user_id }).sort({ created_at: -1 });
  }
  if (!doc) {
    doc = await ModelRegistry.findOne({ model_name, user_id: null, active: true }).sort({ created_at: -1 });
  }
  return res.json(doc || {});
});
module.exports = router;
