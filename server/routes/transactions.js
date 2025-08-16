const express = require('express');
const { createTransaction, listTransactions, getRecentTransactions } = require('../controllers/transactionsController');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
router.use(auth);

router.post('/', createTransaction);
router.get('/', listTransactions);
router.get('/recent', getRecentTransactions)

module.exports = router;

module.exports = router;
