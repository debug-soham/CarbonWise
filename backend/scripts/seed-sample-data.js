// Seed realistic synthetic history for one user, for demos and testing.
//
//   node scripts/seed-sample-data.js --email you@example.com [--months 6] [--dry-run]
//   node scripts/seed-sample-data.js --email you@example.com --remove
//
// Entries run from the start of the month (months - 1) ago up to yesterday,
// in this machine's local time. Every footprint goes through the same
// calculate() the API uses, and every entry is tagged details.synthetic = true
// so --remove deletes exactly these and never the user's real logs.
// Uses MONGODB_URI from backend/.env.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const { connectDB } = require('../db');
const User = require('../models/User');
const Log = require('../models/Log');
const { buildSampleLogs } = require('../sampleData');

function parseArgs(argv) {
    const args = { months: 6, dryRun: false, remove: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--email') args.email = argv[++i];
        else if (a === '--months') args.months = parseInt(argv[++i], 10);
        else if (a === '--dry-run') args.dryRun = true;
        else if (a === '--remove') args.remove = true;
        else throw new Error(`Unknown argument: ${a}`);
    }
    if (!args.email) throw new Error('--email is required');
    if (!(args.months >= 1 && args.months <= 24)) throw new Error('--months must be 1-24');
    return args;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    await connectDB();

    const user = await User.findOne({ email: args.email.trim().toLowerCase() });
    if (!user) throw new Error(`No user with email ${args.email}`);

    const syntheticFilter = { user: user._id, 'details.synthetic': true };

    if (args.remove) {
        const { deletedCount } = await Log.deleteMany(syntheticFilter);
        console.log(`Removed ${deletedCount} synthetic entries for ${user.email}.`);
        return;
    }

    const existing = await Log.countDocuments(syntheticFilter);
    if (existing > 0 && !args.dryRun) {
        throw new Error(`${user.email} already has ${existing} synthetic entries. Run with --remove first.`);
    }

    const { start, end, docs } = buildSampleLogs(user._id, { months: args.months });

    // Per-month summary
    const months = {};
    docs.forEach(d => {
        const key = `${d.date.getFullYear()}-${String(d.date.getMonth() + 1).padStart(2, '0')}`;
        months[key] ??= { entries: 0, energy: 0, transport: 0, food: 0, shopping: 0, total: 0 };
        months[key].entries++;
        months[key][d.category] += d.co2_impact;
        months[key].total += d.co2_impact;
    });
    const fmt = (n) => n.toFixed(1).padStart(8);
    console.log(`\n${args.dryRun ? '[dry run] ' : ''}${docs.length} entries for ${user.email} (${start.toDateString()} to ${end.toDateString()}, exclusive)\n`);
    console.log('month     entries   energy transport     food shopping    total  (kg CO2e)');
    Object.entries(months).forEach(([key, m]) => {
        console.log(`${key}  ${String(m.entries).padStart(7)} ${fmt(m.energy)} ${fmt(m.transport)} ${fmt(m.food)} ${fmt(m.shopping)} ${fmt(m.total)}`);
    });

    if (args.dryRun) return;
    await Log.insertMany(docs);
    console.log(`\nInserted ${docs.length} entries. Remove them any time with --remove.`);
}

main()
    .catch(err => {
        console.error(err.message);
        process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
