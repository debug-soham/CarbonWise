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
const { calculate } = require('../emissions');

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

// Small deterministic PRNG (mulberry32) so reruns produce the same history
function makeRandom(seed) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        chance: (p) => next() < p,
        int: (min, max) => min + Math.floor(next() * (max - min + 1)),
        pick: (list) => list[Math.floor(next() * list.length)]
    };
}

// Build the list of { category, input, date } entries for a Mumbai-based commuter
function generateEntries(start, end, rand) {
    const entries = [];
    const add = (date, hour, category, input) => {
        const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, rand.int(0, 59));
        entries.push({ category, input, date: at });
    };

    // One Mumbai-Delhi return trip, about two months back
    const flightOut = new Date(end.getFullYear(), end.getMonth() - 2, 12);
    const flightBack = new Date(end.getFullYear(), end.getMonth() - 2, 15);
    let nextLpg = new Date(start.getFullYear(), start.getMonth(), rand.int(3, 20));

    for (let day = new Date(start); day < end; day.setDate(day.getDate() + 1)) {
        const weekday = day.getDay(); // 0 = Sunday
        const isWeekend = weekday === 0 || weekday === 6;
        const lastDayOfMonth = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();

        // Getting around
        if (!isWeekend) {
            const r = rand.next();
            if (r < 0.10) {
                // working from home
            } else if (r < 0.80) {
                add(day, 9, 'transport', { mode: 'train', distance: rand.int(24, 36) });
            } else if (r < 0.92) {
                add(day, 9, 'transport', { mode: 'auto_rickshaw', distance: rand.int(8, 14) });
            } else {
                add(day, 9, 'transport', { mode: 'car_petrol', distance: rand.int(28, 40), passengers: 1 });
            }
        } else if (rand.chance(0.55)) {
            if (rand.chance(0.6)) {
                add(day, 11, 'transport', { mode: 'car_petrol', distance: rand.int(20, 70), passengers: rand.int(2, 4) });
            } else {
                add(day, 11, 'transport', { mode: 'motorbike', distance: rand.int(10, 30) });
            }
        }

        if (day.getTime() === flightOut.getTime() || day.getTime() === flightBack.getTime()) {
            add(day, 7, 'transport', { mode: 'flight', distance: 1150 });
        }

        // Meals: mostly vegetarian, with some meat, fish and vegan days
        add(day, 13, 'food', { meal: 'vegetarian', count: rand.int(1, 2) });
        if (rand.chance(0.40)) add(day, 20, 'food', { meal: 'chicken_pork', count: 1 });
        else if (rand.chance(0.20)) add(day, 20, 'food', { meal: 'fish', count: 1 });
        else if (rand.chance(0.05)) add(day, 20, 'food', { meal: 'beef_lamb', count: 1 });
        else add(day, 20, 'food', { meal: 'vegan', count: 1 });

        // Monthly electricity bill on the 28th (more AC in the hot months)
        if (day.getDate() === Math.min(28, lastDayOfMonth)) {
            const hot = [3, 4, 5].includes(day.getMonth()); // Apr-Jun
            add(day, 18, 'energy', { electricity: rand.int(hot ? 230 : 150, hot ? 290 : 210), renewable: false });
        }

        // LPG cylinder (14.2 kg) roughly every six weeks
        if (day >= nextLpg) {
            add(day, 10, 'energy', { lpg: 14.2 });
            nextLpg = new Date(day.getFullYear(), day.getMonth(), day.getDate() + rand.int(38, 50));
        }

        // Occasional shopping, about three purchases a month
        if (rand.chance(0.09)) {
            const item = rand.pick(['tshirt', 'tshirt', 'book', 'book', 'shoes', 'jeans', 'jacket']);
            add(day, 17, 'shopping', { item, quantity: item === 'tshirt' || item === 'book' ? rand.int(1, 2) : 1 });
        }
    }

    // One new phone, about three months back
    add(new Date(end.getFullYear(), end.getMonth() - 3, 9), 16, 'shopping', { item: 'smartphone', quantity: 1 });

    return entries.filter(e => e.date >= start && e.date < end);
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

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (args.months - 1), 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // up to yesterday
    const rand = makeRandom(20261020);

    const docs = generateEntries(start, end, rand).map(({ category, input, date }) => {
        const { co2_impact, details, description } = calculate(category, input);
        return { user: user._id, category, details: { ...details, synthetic: true }, description, co2_impact, date };
    });

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
