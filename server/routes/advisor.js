const express = require('express');
const { chatWithAdvisor } = require('../controllers/advisorController');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
router.use(auth);

router.post('/chat', chatWithAdvisor);

module.exports = router;

