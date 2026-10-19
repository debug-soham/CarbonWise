const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const adminController = require('../controllers/adminController');

// Every admin route needs a signed-in admin
router.use(authController.protect, adminController.requireAdmin);

router.get('/overview', adminController.getOverview);

module.exports = router;
