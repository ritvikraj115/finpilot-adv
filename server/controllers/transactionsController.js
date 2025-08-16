// server/controllers/transactionsController.js
const axios = require('axios');
const Transaction = require('../models/Transaction');
const { v4: uuidv4 } = require('uuid');
const Planner = require('../models/Planner');
const { GoogleGenAI, Type } = require("@google/genai");
const {publishTransaction} = require("../kafka/producer")
const ai = new GoogleGenAI({ apiKey: 'AIzaSyD3nh3x80zD_z4mPMD0X1rgtalOGPJN7SM' });

// New exported handler (non-blocking; publishes an event)
exports.createTransaction = async (req, res, next) => {
  try {
    const { description, amount } = req.body;
    const userId = req.user.id;

    if (!description || !amount) {
      return res.status(400).json({ error: 'description and amount are required' });
    }

    // Create a transaction_id client-side or server-side here
    const transaction_id = req.body.transaction_id || uuidv4();

    // Minimal "ingest record" in DB (optional but recommended)
    // Using ingest_status: 'pending' so consumer can update to 'processed'
    await Transaction.create({
      transaction_id,
      userId,
      description,
      amount,
      category: null,
      ingest_status: 'pending',
      createdAt: new Date()
    });

    // Build event payload -- include raw tx and metadata
    const event = {
      transaction_id,
      user_id: userId,
      description,
      amount,
      currency: req.body.currency || 'INR',
      timestamp: req.body.timestamp || new Date().toISOString(),
      meta: { source: 'api', request_id: req.headers['x-request-id'] || null, ingest_ts: new Date().toISOString() }
    };

    // If USE_KAFKA is disabled (dev mode), run the old inline flow to keep behavior
    if (process.env.USE_KAFKA === 'false') {
      // fallback -- process synchronously (so local dev remains unchanged)
      const txn = await inlineCreateAndProcess({ ...event }, userId);
      return res.status(201).json(txn);
    }

    // Produce event to Kafka and respond immediately
    await publishTransaction(event);

    // Return accepted so frontend is snappy
    return res.status(202).json({ status: 'accepted', transaction_id });
  } catch (err) {
    console.error('createTransaction error:', err.response?.data || err.message || err);
    // If Kafka is down, you might want to persist to an events collection for replay;
    // For now, return 500 to surface the issue
    return next(err);
  }
};
exports.listTransactions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const txns = await Transaction.find({ userId }).sort({ date: -1 });
    res.json(txns);
  } catch (err) {
    next(err);
  }
};

exports.getRecentTransactions = async (req, res, next) => {
  try {
    const userId = req.user.id; // populated by your requireAuth middleware

    // Find the 5 most recent transactions for this user
    const recent = await Transaction.find({ userId })
      .sort({ date: -1 })    // latest first
      .limit(5);

    return res.json(recent);
  } catch (err) {
    console.error("Error in getRecentTransactions:", err);
    next(err);
  }
};

