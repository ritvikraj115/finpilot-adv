// server/models/Transaction.js
const mongoose = require('mongoose');

const explanationSchema = new mongoose.Schema({
  feature: { type: String },
  value: { type: mongoose.Schema.Types.Mixed },
  contrib: { type: Number } // SHAP contribution (positive/negative)
}, { _id: false });

const transactionSchema = new mongoose.Schema({
  // core
  transaction_id: { type: String, required: true, unique: true, index: true },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // original payload
  description: { type: String, required: true },
  merchant_name: { type: String },        // optional
  raw_payload: { type: mongoose.Schema.Types.Mixed }, // to store raw event if desired
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },

  // times
  date: { type: Date, default: Date.now, index: true }, // transaction date
  ingest_ts: { type: Date, default: Date.now },         // when event ingested
  processed_at: { type: Date },

  // ingest / processing state
  ingest_status: { type: String, enum: ['pending', 'processed', 'failed'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  last_error: { type: String },

  // category / prediction
  predicted_category: { type: String },     // model output
  category: { type: String },               // final/confirmed category (user corrected)
  category_source: { type: String, enum: ['model','user','rule'], default: 'model' },
  confidence: { type: Number },             // model confidence if available
  model_run_id: { type: String },           // MLflow run id or model version

  // explainability
  explanation: { type: [explanationSchema], default: [] },

  // routing / meta
  source: { type: String, default: 'api' }, // e.g., 'api','bank_sync','import'
  meta: { type: mongoose.Schema.Types.Mixed },

}, {
  timestamps: true // adds createdAt and updatedAt
});

// Compound indexes (improve common queries)
transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ transaction_id: 1 }, { unique: true });

// Export model
module.exports = mongoose.model('Transaction', transactionSchema);

