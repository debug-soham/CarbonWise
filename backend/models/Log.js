const mongoose = require('mongoose');
const { CATEGORIES } = require('../emissions');

const logSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: String, required: true, enum: CATEGORIES },
    // Raw inputs the footprint was calculated from (e.g. { mode: 'bus', distance: 12 })
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Human-readable summary shown in the activity history
    description: { type: String, default: '' },
    co2_impact: { type: Number, required: true, min: 0 },
    // When the activity happened (can be backdated), not when it was logged
    date: { type: Date, default: Date.now }
}, { timestamps: true });

// Dashboard queries are always "this user's logs in a date range"
logSchema.index({ user: 1, date: -1 });

module.exports = mongoose.model('Log', logSchema);
module.exports.CATEGORIES = CATEGORIES;
