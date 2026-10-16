const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true, select: false },
    monthly_limit: { type: Number, default: 400, min: 0.01 }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
