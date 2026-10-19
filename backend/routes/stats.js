const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');

// Public: shown on the landing page
router.get('/public', statsController.getPublicStats);

module.exports = router;
