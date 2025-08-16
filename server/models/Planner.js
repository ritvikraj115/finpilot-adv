const mongoose = require('mongoose');

// Sub‐schema for individual future expenses (now includes category)
const futureExpenseSchema = new mongoose.Schema({
  description: { type: String, required: true },
  amount:      { type: Number, required: true },
  category:    { type: String, required: true }    // e.g., "Food", "Education", etc.
});

// Main Planner schema
const plannerSchema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  month:          { type: String, required: true },   // e.g. "2025-06"
  budget:         { type: Number, required: true },

  // New field: numeric limits for each category
  categoryLimits: {
    Food:           { type: Number, default: 0 },
    Education:      { type: Number, default: 0 },
    Apparel:        { type: Number, default: 0 },
    Transportation: { type: Number, default: 0 },
    Household:      { type: Number, default: 0 },
    Miscellaneous:  { type: Number, default: 0 }
  },

  futureExpenses: [futureExpenseSchema]
}, { timestamps: true });

module.exports = mongoose.model('Planner', plannerSchema);

