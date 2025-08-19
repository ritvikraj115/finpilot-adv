// server/models/ModelRegistry.js
const mongoose = require('mongoose');

const ModelRegistrySchema = new mongoose.Schema({
  run_id: { type: String, required: true, unique: true, index: true }, // MLflow run id or canonical run identifier
  model_name: { type: String, required: true, index: true },
  user_id: { type: String, default: null, index: true }, // null => global model
  local_model_path: { type: String, required: true }, // path/URI to model artifact (may be mlflow:/ or local file)
  scaler_path: { type: String, required: true },      // path/URI to scaler artifact
  metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['created','validated','failed','active','inactive'], default: 'created' },
  created_at: { type: Date, default: () => new Date() },
  activated_at: { type: Date, default: null },
  active: { type: Boolean, default: false },
  notes: { type: String, default: '' }
});

// Compound index for quick lookup of active model per (model_name, user_id)
ModelRegistrySchema.index({ model_name: 1, user_id: 1, active: 1 });

module.exports = mongoose.model('ModelRegistry', ModelRegistrySchema);

