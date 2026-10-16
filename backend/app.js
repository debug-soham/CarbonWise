const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const logRoutes = require('./routes/logs');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
// Express 5 leaves req.body undefined when no body is sent
app.use((req, res, next) => { req.body = req.body || {}; next(); });

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/logs', logRoutes);


// Root endpoint
app.get('/', (req, res) => {
    res.send('CarbonWise Backend API is running! 🌍 Please visit the Vercel frontend URL to use the app.');
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'CarbonWise API is running!' });
});

module.exports = app;
