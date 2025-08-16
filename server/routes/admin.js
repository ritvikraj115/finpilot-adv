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

module.exports = router;
