const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'super-secret-jwt-key-carbonwise'; // In production, use environment variables

// Register a new user
exports.register = async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Please provide all required fields.' });
    }

    try {
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert into database
        const sql = `INSERT INTO users (name, email, password) VALUES (?, ?, ?)`;
        db.run(sql, [name, email, hashedPassword], function (err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ message: 'User with this email already exists.' });
                }
                console.error(err);
                return res.status(500).json({ message: 'Internal server error.' });
            }

            // Generate token
            const token = jwt.sign({ id: this.lastID, name }, JWT_SECRET, { expiresIn: '7d' });

            res.status(201).json({
                message: 'User registered successfully!',
                token,
                user: { id: this.lastID, name, email }
            });
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// Login existing user
exports.login = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Please provide email and password.' });
    }

    const sql = `SELECT * FROM users WHERE email = ?`;
    db.get(sql, [email], async (err, user) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Internal server error.' });
        }

        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        // Compare password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        // Generate token
        const token = jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            message: 'Login successful',
            token,
            user: { id: user.id, name: user.name, email: user.email }
        });
    });
};

// Middleware to protect routes
exports.protect = (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ message: 'Not authorized to access this route. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Not authorized. Token invalid.' });
    }
};

// Get current user (protected)
exports.getMe = (req, res) => {
    const sql = `SELECT id, name, email, monthly_limit FROM users WHERE id = ?`;
    db.get(sql, [req.user.id], (err, user) => {
        if (err || !user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ user });
    });
};

// Update current user settings
exports.updateMe = (req, res) => {
    const { monthly_limit } = req.body;
    
    if (monthly_limit === undefined) {
        return res.status(400).json({ message: 'monthly_limit is required' });
    }

    const sql = `UPDATE users SET monthly_limit = ? WHERE id = ?`;
    db.run(sql, [parseFloat(monthly_limit), req.user.id], function (err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: 'Failed to update settings' });
        }
        res.json({ message: 'Settings updated successfully', monthly_limit: parseFloat(monthly_limit) });
    });
};
