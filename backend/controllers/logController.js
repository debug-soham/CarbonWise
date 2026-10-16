const mongoose = require('mongoose');
const Log = require('../models/Log');
const User = require('../models/User');

// Add a new consumption log
exports.addLog = async (req, res) => {
    const { category, electricity, gas, useRenewables } = req.body;

    if (!category) {
        return res.status(400).json({ message: 'Category is required' });
    }

    // Basic calculation logic for demo
    // Real-world would use accurate emission factors
    let co2_impact = 0;
    let details = {};

    if (category === 'energy') {
        const elecValue = parseFloat(electricity) || 0;
        const gasValue = parseFloat(gas) || 0;

        if (elecValue < 0 || gasValue < 0) {
            return res.status(400).json({ message: 'Usage values cannot be negative.' });
        }
        if (elecValue === 0 && gasValue === 0) {
            return res.status(400).json({ message: 'Enter electricity or gas usage to log.' });
        }

        // Example: 1 kWh = ~0.4 kg CO2e, 1 therm natural gas = ~5.3 kg CO2e
        let elecImpact = elecValue * 0.4;
        if (useRenewables) {
            elecImpact *= 0.1; // 90% reduction if renewables
        }

        const gasImpact = gasValue * 5.3;
        co2_impact = elecImpact + gasImpact;
        details = { electricity: elecValue, gas: gasValue, useRenewables: Boolean(useRenewables) };
    } else if (Log.CATEGORIES.includes(category)) {
        // Fallback for other categories in future
        co2_impact = 5.0;
    } else {
        return res.status(400).json({ message: 'Unknown category' });
    }

    try {
        const log = await Log.create({ user: req.user.id, category, details, co2_impact });

        res.status(201).json({
            message: 'Log added successfully',
            log: { id: log.id, category, details, co2_impact, date: log.date }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to add log' });
    }
};

// Get aggregated metrics for the dashboard
exports.getMetrics = async (req, res) => {
    try {
        const userId = new mongoose.Types.ObjectId(req.user.id);

        // We want total CO2 impact, and breakdowns by category
        const [rows, user] = await Promise.all([
            Log.aggregate([
                { $match: { user: userId } },
                { $group: { _id: '$category', total_impact: { $sum: '$co2_impact' } } }
            ]),
            User.findById(userId).select('monthly_limit')
        ]);

        let totalCo2 = 0;
        const breakdown = Object.fromEntries(Log.CATEGORIES.map(c => [c, 0]));

        rows.forEach(row => {
            totalCo2 += row.total_impact;
            breakdown[row._id] = row.total_impact;
        });

        res.json({
            total: totalCo2.toFixed(2),
            breakdown,
            monthly_limit: user && user.monthly_limit > 0 ? user.monthly_limit : 400
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch metrics' });
    }
};
