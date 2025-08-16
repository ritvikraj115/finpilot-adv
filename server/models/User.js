// server/models/User.js
const mongoose = require('mongoose');

const budgetSchema = new mongoose.Schema({
  category: { type: String, required: true },
  limit: { type: Number, required: true }
});

const userSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true }, // hash in production!
  budgets:  [budgetSchema]                  // e.g., [{category:"Food",limit:6000},…]
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);
