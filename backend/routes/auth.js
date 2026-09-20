const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Register route
router.post('/register', authController.register);

// Login route
router.post('/login', authController.login);

// Get current user route (protected)
router.get('/me', authController.protect, authController.getMe);

module.exports = router;
