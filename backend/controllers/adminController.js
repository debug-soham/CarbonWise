const mongoose = require('mongoose');
const User = require('../models/User');
const statsService = require('../statsService');

// ADMIN_EMAILS is read on every call so a change on Render applies without code changes
function isAdminEmail(email) {
    const admins = (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);
    return typeof email === 'string' && admins.includes(email.trim().toLowerCase());
}

// Middleware (after protect): only accounts listed in ADMIN_EMAILS
async function requireAdmin(req, res, next) {
    if (req.user.demo) {
        return res.status(403).json({ message: 'Admin access required' });
    }
    try {
        const user = await User.findById(req.user.id);
        if (!user || user.is_demo || !isAdminEmail(user.email)) {
            return res.status(403).json({ message: 'Admin access required' });
        }
        req.admin = user;
        next();
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error.' });
    }
}

exports.isAdminEmail = isAdminEmail;
exports.requireAdmin = requireAdmin;

// Public figures next to the raw ones, plus how many accounts are in each status
exports.getOverview = async (req, res) => {
    try {
        res.json(await statsService.getAdminOverview());
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Could not load the overview' });
    }
};
