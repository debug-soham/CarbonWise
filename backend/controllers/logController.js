const db = require('../db');

// Add a new consumption log
exports.addLog = (req, res) => {
    const { category, electricity, gas, useRenewables } = req.body;
    const userId = req.user.id;

    if (!category) {
        return res.status(400).json({ message: 'Category is required' });
    }

    // Basic calculation logic for demo
    // Real-world would use accurate emission factors
    let co2_impact = 0;

    if (category === 'energy') {
        const elecValue = parseFloat(electricity) || 0;
        const gasValue = parseFloat(gas) || 0;

        // Example: 1 kWh = ~0.4 kg CO2e, 1 therm natural gas = ~5.3 kg CO2e
        let elecImpact = elecValue * 0.4;
        if (useRenewables) {
            elecImpact *= 0.1; // 90% reduction if renewables
        }

        const gasImpact = gasValue * 5.3;
        co2_impact = elecImpact + gasImpact;
    } else {
        // Fallback for other categories in future
        co2_impact = 5.0;
    }

    const sql = `INSERT INTO logs (user_id, category, value, co2_impact) VALUES (?, ?, ?, ?)`;
    // We store total input value as a simple sum for the 'value' column
    const totalValue = (parseFloat(electricity) || 0) + (parseFloat(gas) || 0);

    db.run(sql, [userId, category, totalValue, co2_impact], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to add log' });
        }

        res.status(201).json({
            message: 'Log added successfully',
            log: { id: this.lastID, category, value: totalValue, co2_impact }
        });
    });
};

// Get aggregated metrics for the dashboard
exports.getMetrics = (req, res) => {
    const userId = req.user.id;

    // We want total CO2 impact, and breakdowns by category
    const sql = `
        SELECT category, SUM(co2_impact) as total_impact
        FROM logs
        WHERE user_id = ?
        GROUP BY category
    `;

    db.all(sql, [userId], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to fetch metrics' });
        }

        let totalCo2 = 0;
        const breakdown = {
            energy: 0,
            transport: 0,
            food: 0,
            shopping: 0,
            materials: 0,
            packaging: 0
        };

        rows.forEach(row => {
            totalCo2 += row.total_impact;
            if (breakdown[row.category] !== undefined) {
                breakdown[row.category] = row.total_impact;
            }
        });

        // Let's add some default mock data for other categories so the dashboard isn't completely empty initially
        if (totalCo2 === 0) {
            breakdown.transport = 2.20;
            breakdown.food = 7.52;
            breakdown.shopping = 3.62;
            breakdown.energy = 0; // Starts at 0 until they add
            totalCo2 = 13.34;
        }


        // Also fetch monthly limit
        db.get('SELECT monthly_limit FROM users WHERE id = ?', [userId], (err, userRow) => {
            let limit = 400.0;
            if (!err && userRow && userRow.monthly_limit) {
                limit = userRow.monthly_limit;
            }

            res.json({
                total: totalCo2.toFixed(2),
                breakdown,
                monthly_limit: limit
            });
        });
    });
};

