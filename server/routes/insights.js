// server/routes/insights.js
const express = require('express');
const auth    = require('../middleware/authMiddleware');
const {
  getCategoryTotals,
  getMonthlyTrend,
  getOverspendAlert,
  getMonthlyBudget,
  getPrediction,
  getMonthlyCategoryTotals,
  getAiInsights
} = require('../controllers/insightsController');

const router = express.Router();
router.use(auth);

router.get('/categories',   getCategoryTotals);
router.get('/trend',        getMonthlyTrend);
router.get('/overspend',    getOverspendAlert);
router.get('/monthly-budget', getMonthlyBudget);
router.get('/predict',      getPrediction);
router.get('/monthlycategories',      getMonthlyCategoryTotals);
router.post('/getinsights',      getAiInsights);

module.exports = router;

