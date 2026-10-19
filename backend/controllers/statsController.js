const statsService = require('../statsService');

// Aggregate impact figures for the landing page (no sign-in needed)
exports.getPublicStats = async (req, res) => {
    try {
        res.json(await statsService.getPublicStats());
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Could not load impact figures' });
    }
};
