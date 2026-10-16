const mongoose = require('mongoose');
const Log = require('../models/Log');
const User = require('../models/User');
const { FACTORS, CATEGORIES, calculate, ValidationError } = require('../emissions');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BACKDATE_DAYS = 365 * 2;

const toPublicLog = (log) => ({
    id: log.id,
    category: log.category,
    details: log.details,
    description: log.description,
    co2_impact: log.co2_impact,
    date: log.date
});

// Parse ?from=&to= (ISO dates). Defaults to the current calendar month (UTC).
// The client sends its own local month boundaries so time zones line up.
function parseRange(query) {
    const now = new Date();
    const from = query.from ? new Date(query.from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = query.to ? new Date(query.to) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new ValidationError('from and to must be valid dates.');
    }
    if (from >= to) {
        throw new ValidationError('from must be before to.');
    }
    return { from, to };
}

// Emission factor catalogue so the frontend can build its forms
exports.getFactors = (req, res) => {
    res.json({ factors: FACTORS });
};

// Add a new consumption log
exports.addLog = async (req, res) => {
    const { category } = req.body;

    if (!category) {
        return res.status(400).json({ message: 'Category is required' });
    }

    try {
        const { co2_impact, details, description } = calculate(category, req.body);

        let date = new Date();
        if (req.body.date) {
            date = new Date(req.body.date);
            if (Number.isNaN(date.getTime())) {
                throw new ValidationError('Please provide a valid date.');
            }
            // Allow a day of slack for clients ahead of the server's time zone
            if (date.getTime() > Date.now() + DAY_MS) {
                throw new ValidationError('Date cannot be in the future.');
            }
            if (date.getTime() < Date.now() - MAX_BACKDATE_DAYS * DAY_MS) {
                throw new ValidationError('Date is too far in the past.');
            }
        }

        const log = await Log.create({ user: req.user.id, category, details, description, co2_impact, date });

        res.status(201).json({
            message: 'Log added successfully',
            log: toPublicLog(log)
        });
    } catch (error) {
        if (error instanceof ValidationError) {
            return res.status(400).json({ message: error.message });
        }
        console.error(error);
        res.status(500).json({ message: 'Failed to add log' });
    }
};

// List the user's logs, newest first: ?from=&to=&category=&limit=
exports.listLogs = async (req, res) => {
    try {
        const filter = { user: req.user.id };

        if (req.query.from || req.query.to) {
            const { from, to } = parseRange(req.query);
            filter.date = { $gte: from, $lt: to };
        }
        if (req.query.category) {
            if (!CATEGORIES.includes(req.query.category)) {
                throw new ValidationError('Unknown category.');
            }
            filter.category = req.query.category;
        }

        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const logs = await Log.find(filter).sort({ date: -1, _id: -1 }).limit(limit);

        res.json({ logs: logs.map(toPublicLog) });
    } catch (error) {
        if (error instanceof ValidationError) {
            return res.status(400).json({ message: error.message });
        }
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch logs' });
    }
};

// Delete one of the user's own logs
exports.deleteLog = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
        return res.status(404).json({ message: 'Log not found' });
    }

    try {
        // Scoped to the user so nobody can delete someone else's log
        const log = await Log.findOneAndDelete({ _id: req.params.id, user: req.user.id });
        if (!log) {
            return res.status(404).json({ message: 'Log not found' });
        }
        res.json({ message: 'Log deleted', id: log.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to delete log' });
    }
};

const MAX_SERIES_DAYS = 400;
const PERIOD_FORMATS = { day: '%Y-%m-%d', month: '%Y-%m' };

function parseTimeZone(tz) {
    if (!tz) return 'UTC';
    try {
        // Throws RangeError for unknown IANA zones
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return tz;
    } catch (err) {
        throw new ValidationError('Unknown time zone.');
    }
}

// Totals per day or month for charts: ?from=&to=&unit=day|month&tz=Asia/Kolkata
// Periods are computed in the given time zone so late-evening logs land on the right day.
exports.getSeries = async (req, res) => {
    try {
        const { from, to } = parseRange(req.query);
        const unit = req.query.unit || 'day';
        if (!PERIOD_FORMATS[unit]) {
            throw new ValidationError('unit must be "day" or "month".');
        }
        if (to - from > MAX_SERIES_DAYS * DAY_MS) {
            throw new ValidationError(`Range cannot exceed ${MAX_SERIES_DAYS} days.`);
        }
        const timezone = parseTimeZone(req.query.tz);

        const rows = await Log.aggregate([
            { $match: { user: new mongoose.Types.ObjectId(req.user.id), date: { $gte: from, $lt: to } } },
            {
                $group: {
                    _id: {
                        period: { $dateToString: { format: PERIOD_FORMATS[unit], date: '$date', timezone } },
                        category: '$category'
                    },
                    total: { $sum: '$co2_impact' },
                    count: { $sum: 1 }
                }
            }
        ]);

        const byPeriod = new Map();
        rows.forEach(({ _id, total, count }) => {
            if (!byPeriod.has(_id.period)) {
                byPeriod.set(_id.period, {
                    period: _id.period,
                    total: 0,
                    count: 0,
                    breakdown: Object.fromEntries(CATEGORIES.map(c => [c, 0]))
                });
            }
            const entry = byPeriod.get(_id.period);
            entry.total += total;
            entry.count += count;
            entry.breakdown[_id.category] = total;
        });

        const series = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
        res.json({ unit, timezone, series });
    } catch (error) {
        if (error instanceof ValidationError) {
            return res.status(400).json({ message: error.message });
        }
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch series' });
    }
};

// Get aggregated metrics for the dashboard over a date range (?from=&to=)
exports.getMetrics = async (req, res) => {
    try {
        const { from, to } = parseRange(req.query);
        const userId = new mongoose.Types.ObjectId(req.user.id);

        const [rows, user] = await Promise.all([
            Log.aggregate([
                { $match: { user: userId, date: { $gte: from, $lt: to } } },
                { $group: { _id: '$category', total_impact: { $sum: '$co2_impact' }, count: { $sum: 1 } } }
            ]),
            User.findById(userId).select('monthly_limit')
        ]);

        let totalCo2 = 0;
        let count = 0;
        const breakdown = Object.fromEntries(CATEGORIES.map(c => [c, 0]));

        rows.forEach(row => {
            totalCo2 += row.total_impact;
            count += row.count;
            breakdown[row._id] = row.total_impact;
        });

        res.json({
            total: totalCo2.toFixed(2),
            breakdown,
            count,
            from,
            to,
            monthly_limit: user && user.monthly_limit > 0 ? user.monthly_limit : 400
        });
    } catch (error) {
        if (error instanceof ValidationError) {
            return res.status(400).json({ message: error.message });
        }
        console.error(error);
        res.status(500).json({ message: 'Failed to fetch metrics' });
    }
};
