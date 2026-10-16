const express = require('express');
const router = express.Router();
const logController = require('../controllers/logController');
const authController = require('../controllers/authController');

// All log routes are protected
router.use(authController.protect);

router.get('/', logController.listLogs);
router.post('/', logController.addLog);
router.get('/metrics', logController.getMetrics);
router.get('/factors', logController.getFactors);
router.delete('/:id', logController.deleteLog);

module.exports = router;
