const express = require('express');
const auth    = require('../middleware/authMiddleware');
const {
  upsertPlanner,
  getPlanner,
  recalculateForecast
} = require('../controllers/plannerController');

const router = express.Router();
router.use(auth);

router.post('/', upsertPlanner);         // { month, budget, futureExpenses }
router.get('/:month', getPlanner);   
router.post('/retrain', recalculateForecast)   // /api/planner/2025-06

module.exports = router;
