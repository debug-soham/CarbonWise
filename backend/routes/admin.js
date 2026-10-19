const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const adminController = require('../controllers/adminController');

// Every admin route needs a signed-in admin
router.use(authController.protect, adminController.requireAdmin);

router.get('/overview', adminController.getOverview);
router.get('/flags', adminController.getFlags);
router.get('/users', adminController.listUsers);
router.patch('/users/:id', adminController.updateUser);
router.post('/users/:id/dismiss-flags', adminController.dismissFlags);

module.exports = router;
