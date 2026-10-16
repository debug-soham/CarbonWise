const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET environment variable is required in production.');
    }
    console.warn('JWT_SECRET not set; using an insecure development secret.');
    return 'dev-only-insecure-jwt-secret';
})();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toPublicUser = (user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    monthly_limit: user.monthly_limit
});

const signToken = (user) => jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

// Register a new user
exports.register = async (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Please provide all required fields.' });
    }
    if (!EMAIL_PATTERN.test(email)) {
        return res.status(400).json({ message: 'Please provide a valid email address.' });
    }
    if (password.length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters long.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ name, email, password: hashedPassword });

        res.status(201).json({
            message: 'User registered successfully!',
            token: signToken(user),
            user: toPublicUser(user)
        });
    } catch (error) {
        // 11000 = duplicate key on the unique email index
        if (error.code === 11000) {
            return res.status(400).json({ message: 'User with this email already exists.' });
        }
        console.error(error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// Login existing user
exports.login = async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !password) {
        return res.status(400).json({ message: 'Please provide email and password.' });
    }

    try {
        const user = await User.findOne({ email }).select('+password');
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: 'Invalid credentials.' });
        }

        res.json({
            message: 'Login successful',
            token: signToken(user),
            user: toPublicUser(user)
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error.' });
    }
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
        if (!mongoose.isValidObjectId(decoded.id)) {
            return res.status(401).json({ message: 'Not authorized. Token invalid.' });
        }
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Not authorized. Token invalid.' });
    }
};

// Get current user (protected)
exports.getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ user: toPublicUser(user) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// Update current user settings
exports.updateMe = async (req, res) => {
    const monthlyLimit = parseFloat(req.body.monthly_limit);

    if (!Number.isFinite(monthlyLimit) || monthlyLimit <= 0) {
        return res.status(400).json({ message: 'Monthly limit must be a positive number.' });
    }

    try {
        const user = await User.findByIdAndUpdate(req.user.id, { monthly_limit: monthlyLimit }, { returnDocument: 'after', runValidators: true });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ message: 'Settings updated successfully', monthly_limit: user.monthly_limit });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update settings' });
    }
};
