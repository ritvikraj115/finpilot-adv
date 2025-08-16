const Planner = require('../models/Planner');
const Transaction= require('../models/Transaction')
const axios= require('axios')

exports.upsertPlanner = async (req, res, next) => {
  try {
    const { month, budget, futureExpenses, categoryLimits } = req.body;
    const userId = req.user.id;

    const update = {
      budget,
      futureExpenses,
      categoryLimits
    };

    const doc = await Planner.findOneAndUpdate(
      { userId, month },
      update,
      { upsert: true, new: true }
    );

    res.json(doc);
  } catch (err) {
    next(err);
  }
};


// Fetch planner for a given month
exports.getPlanner = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { month } = req.params;        // e.g. "2025-06"
    const doc = await Planner.findOne({ userId, month });
    res.json(doc || { month, budget: 0, futureExpenses: [] });
  } catch (err) {
    next(err);
  }
};

exports.recalculateForecast = async (req, res, next) => {
  try {
    const hist = await Transaction.find({
      userId: req.user.id
    }).sort({ date: 1 });

    if (hist.length < 30) {
      return res.status(400).json({ error: 'Need at least 30 transactions to retrain.' });
    }

    const recent = hist.slice(-365); // take at most 365
    const series = recent.map(d => d.amount);
    const mlRes = await axios.post(`${process.env.MLSERVICE_URL}/retrain`, { series });
    res.json({ message: 'Retraining triggered.', mlStatus: mlRes.data.status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Retrain failed.' });
  }
}
