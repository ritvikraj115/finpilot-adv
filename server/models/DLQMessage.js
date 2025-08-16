// server/models/DLQMessage.js
const mongoose = require('mongoose');

const dlqSchema = new mongoose.Schema({
  topic: { type: String, required: true },
  partition: { type: Number },
  offset: { type: String },
  key: { type: String },
  value: { type: mongoose.Schema.Types.Mixed }, // original message or parsed JSON
  error: { type: String },
  attempts: { type: Number, default: 0 },
  received_at: { type: Date, default: Date.now },
  retried_at: { type: Date },
  retry_count: { type: Number, default: 0 },
  retry_status: { type: String, enum: ['pending','retried','failed','deleted'], default: 'pending' },
}, { timestamps: true });

module.exports = mongoose.model('DLQMessage', dlqSchema);
