const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Log = require('../models/Log');
const { buildSampleLogs } = require('../sampleData');
const { isAdminEmail } = require('./adminController');

const JWT_SECRET = process.env.JWT_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET environment variable is required in production.');
    }
    console.warn('JWT_SECRET not set; using an insecure development secret.');
    return 'dev-only-insecure-jwt-secret';
})();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 60;
// Reserved for the demo account; .invalid can never be a real address
const DEMO_EMAIL = 'demo@carbonwise.invalid';
const DEMO_READ_ONLY_MESSAGE = 'The live demo is read-only. Create a free account to log your own activities.';

const toPublicUser = (user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    monthly_limit: user.monthly_limit,
    is_demo: Boolean(user.is_demo)
});

const signToken = (user) => user.is_demo
    ? jwt.sign({ id: user.id, name: user.name, demo: true }, JWT_SECRET, { expiresIn: '2h' })
    : jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

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
    if (name.length > MAX_NAME_LENGTH) {
        return res.status(400).json({ message: `Name must be at most ${MAX_NAME_LENGTH} characters.` });
    }
    if (email.endsWith('@carbonwise.invalid')) {
        return res.status(400).json({ message: 'Please provide a valid email address.' });
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
        res.json({ user: { ...toPublicUser(user), is_admin: !user.is_demo && isAdminEmail(user.email) } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

// Update current user: name and/or monthly_limit
exports.updateMe = async (req, res) => {
    const updates = {};

    if (req.body.name !== undefined) {
        const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        if (!name) {
            return res.status(400).json({ message: 'Name cannot be empty.' });
        }
        if (name.length > MAX_NAME_LENGTH) {
            return res.status(400).json({ message: `Name must be at most ${MAX_NAME_LENGTH} characters.` });
        }
        updates.name = name;
    }

    if (req.body.monthly_limit !== undefined) {
        const monthlyLimit = parseFloat(req.body.monthly_limit);
        if (!Number.isFinite(monthlyLimit) || monthlyLimit <= 0) {
            return res.status(400).json({ message: 'Monthly limit must be a positive number.' });
        }
        updates.monthly_limit = monthlyLimit;
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ message: 'Nothing to update.' });
    }

    try {
        const user = await User.findByIdAndUpdate(req.user.id, updates, { returnDocument: 'after', runValidators: true });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ message: 'Settings updated successfully', user: toPublicUser(user), monthly_limit: user.monthly_limit });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Failed to update settings' });
    }
};

// Middleware: block writes from the shared demo account
exports.forbidDemo = (req, res, next) => {
    if (req.user && req.user.demo) {
        return res.status(403).json({ message: DEMO_READ_ONLY_MESSAGE });
    }
    next();
};

// Make sure the demo user exists and its sample history runs up to yesterday
async function prepareDemoUser() {
    let user = await User.findOne({ is_demo: true });
    if (!user) {
        // Random password nobody knows: the demo is only reachable through /api/auth/demo
        const password = await bcrypt.hash(require('crypto').randomBytes(32).toString('hex'), 10);
        user = await User.create({ name: 'Demo User', email: DEMO_EMAIL, password, is_demo: true });
    }

    const now = new Date();
    const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const newest = await Log.findOne({ user: user._id }).sort({ date: -1 }).select('date');

    // Regenerate once a day so the demo always shows the last six months
    if (!newest || newest.date < startOfYesterday) {
        await Log.deleteMany({ user: user._id });
        const { docs } = buildSampleLogs(user._id, { months: 6, now });
        await Log.insertMany(docs);
    }
    return user;
}

// One refresh at a time, even if several visitors click "Live demo" together
let demoRefresh = null;

// Sign in to the read-only demo account
exports.demo = async (req, res) => {
    try {
        if (!demoRefresh) {
            demoRefresh = prepareDemoUser().finally(() => { demoRefresh = null; });
        }
        const user = await demoRefresh;

        res.json({
            message: 'Demo session started',
            token: signToken(user),
            user: toPublicUser(user)
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Could not start the demo. Please try again.' });
    }
};
