const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true, select: false },
    monthly_limit: { type: Number, default: 400, min: 0.01 },
    // The shared read-only account behind the landing page's "Live demo"
    is_demo: { type: Boolean, default: false },
    // How this account is treated in the public impact figures (set by admins)
    stats_status: { type: String, enum: ['auto', 'excluded', 'trusted'], default: 'auto' },
    // Entries created before this time no longer raise fake-data flags
    flags_dismissed_at: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
