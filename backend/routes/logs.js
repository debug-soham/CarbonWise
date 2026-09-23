const express = require('express');
const router = express.Router();
const logController = require('../controllers/logController');
const authController = require('../controllers/authController');

// All log routes are protected
router.use(authController.protect);

router.post('/', logController.addLog);
router.get('/metrics', logController.getMetrics);

module.exports = router;

