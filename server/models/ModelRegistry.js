// server/models/ModelRegistry.js
const mongoose = require('mongoose');

const ModelRegistrySchema = new mongoose.Schema({
  run_id: { type: String, required: true, unique: true },
  model_name: { type: String, required: true, index: true },
  user_id: { type: String, default: null, index: true }, // null => global model
  local_model_path: { type: String, required: true },
  scaler_path: { type: String, required: true },
  metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
  created_at: { type: Date, default: () => new Date() },
  active: { type: Boolean, default: false } // whether this model is active for the user
});

module.exports = mongoose.model('ModelRegistry', ModelRegistrySchema);
