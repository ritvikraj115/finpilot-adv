// server/models/ModelRegistry.js
const mongoose = require('mongoose');

const modelRegistrySchema = new mongoose.Schema({
  model_name: { type: String, required: true, index: true },
  run_id: { type: String, required: true },
  local_model_path: { type: String },
  scaler_path: { type: String },
  metrics: { type: mongoose.Schema.Types.Mixed },
  created_at: { type: Date, default: Date.now },
  metadata: { type: mongoose.Schema.Types.Mixed }
});

module.exports = mongoose.model('ModelRegistry', modelRegistrySchema);
