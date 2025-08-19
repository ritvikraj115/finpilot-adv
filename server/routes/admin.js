// server/routes/admin.js
const express = require('express');
const router = express.Router();

const DLQMessage = require('../models/DLQMessage');
const ModelRegistry = require('../models/ModelRegistry');   // <-- MISSING import added
const { publishTransaction } = require('../kafka/producer'); // re-use existing producer for retries

// NOTE: Protect these endpoints in prod (auth/mTLS/API key)

// ------------------ DLQ ROUTES ------------------

// List recent DLQ items
router.get('/dlq', async (req, res, next) => {
  try {
    const items = await DLQMessage.find({})
      .sort({ received_at: -1 })
      .limit(200);
    res.json(items);
  } catch (err) { next(err); }
});

// Get a specific DLQ item
router.get('/dlq/:id', async (req, res, next) => {
  try {
    const item = await DLQMessage.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    res.json(item);
  } catch (err) { next(err); }
});

// Retry a DLQ item by republishing its original event
router.post('/dlq/:id/retry', async (req, res, next) => {
  try {
    const item = await DLQMessage.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });

    const payload =
      item.value && item.value.original_event
        ? item.value.original_event
        : item.value;

    if (!payload) return res.status(400).json({ error: 'no original event to retry' });

    await publishTransaction(payload);

    item.retry_count = (item.retry_count || 0) + 1;
    item.retried_at = new Date();
    item.retry_status = 'retried';
    await item.save();

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Delete a DLQ item
router.delete('/dlq/:id', async (req, res, next) => {
  try {
    await DLQMessage.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ------------------ MODEL REGISTRY ROUTES ------------------

// Create a model registry entry
router.post('/models', async (req, res) => {
  try {
    const doc = await ModelRegistry.create(req.body);
    return res.status(201).json(doc);
  } catch (e) {
    console.error('admin: failed to create model registry', e);
    return res.status(500).json({ error: String(e) });
  }
});

// List/filter models
router.get('/models', async (req, res) => {
  try {
    const q = {};
    if (req.query.model_name) q.model_name = req.query.model_name;
    if (req.query.user_id) q.user_id = req.query.user_id;
    const docs = await ModelRegistry.find(q).sort({ created_at: -1 }).limit(200);
    return res.json(docs);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// Activate a model run for given user/global
router.post('/models/:run_id/activate', async (req, res) => {
  const { run_id } = req.params;
  const { user_id } = req.body; // null => global
  try {
    const doc = await ModelRegistry.findOne({ run_id });
    if (!doc) return res.status(404).json({ error: 'not found' });

    // deactivate any existing active for this (model_name,user_id)
    await ModelRegistry.updateMany(
      { model_name: doc.model_name, user_id: user_id || null, active: true },
      { $set: { active: false, status: 'inactive' } }
    );

    doc.active = true;
    doc.user_id = user_id || null;
    doc.status = 'active';
    doc.activated_at = new Date();
    await doc.save();

    return res.json(doc);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// Get active model (prefer user-specific, else global)
router.get('/models/active', async (req, res) => {
  try {
    const { model_name, user_id } = req.query;
    if (!model_name) return res.status(400).json({ error: 'model_name is required' });

    let doc = null;
    if (user_id) {
      doc = await ModelRegistry.findOne({
        model_name,
        user_id,
        active: true
      }).sort({ activated_at: -1 });
    }

    if (!doc) {
      doc = await ModelRegistry.findOne({
        model_name,
        user_id: null,
        active: true
      }).sort({ activated_at: -1 });
    }

    return res.json(doc || {});
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

module.exports = router;

