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

const EDITABLE_STATUSES = ['auto', 'excluded', 'trusted'];

// Shared lookup for the per-user actions; sends the error response itself
async function findTargetUser(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: 'User not found' });
        return null;
    }
    const user = await User.findById(req.params.id);
    if (!user) {
        res.status(404).json({ message: 'User not found' });
        return null;
    }
    if (user.is_demo) {
        res.status(400).json({ message: "The demo account's status can't be changed" });
        return null;
    }
    return user;
}

exports.getFlags = async (req, res) => {
    try {
        res.json(await statsService.getFlaggedUsers());
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Could not load flagged accounts' });
    }
};

exports.listUsers = async (req, res) => {
    const status = req.query.status || '';
    if (status && !statsService.STATUSES.includes(status)) {
        return res.status(400).json({ message: 'Invalid status' });
    }
    try {
        res.json(await statsService.listUsers({
            search: req.query.search || '',
            status,
            page: parseInt(req.query.page, 10) || 1
        }));
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Could not load users' });
    }
};

// Exclude, trust or reset an account to automatic rules
exports.updateUser = async (req, res) => {
    try {
        const user = await findTargetUser(req, res);
        if (!user) return;
        if (!EDITABLE_STATUSES.includes(req.body.stats_status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }
        user.stats_status = req.body.stats_status;
        await user.save();
        statsService.invalidate();
        res.json({ message: 'Status updated', id: user.id, stats_status: user.stats_status });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Could not update the account' });
    }
};

// Clear current flags; only entries created after now can flag the account again
exports.dismissFlags = async (req, res) => {
    try {
        const user = await findTargetUser(req, res);
        if (!user) return;
        user.flags_dismissed_at = new Date();
        await user.save();
        statsService.invalidate();
        res.json({ message: 'Flags dismissed', id: user.id, flags_dismissed_at: user.flags_dismissed_at });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Could not dismiss flags' });
    }
};

// Public figures next to the raw ones, plus how many accounts are in each status
exports.getOverview = async (req, res) => {
    try {
        res.json(await statsService.getAdminOverview());
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Could not load the overview' });
    }
};
