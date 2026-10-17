// Realistic synthetic history for demos: a Mumbai-based commuter.
// Shared by scripts/seed-sample-data.js and the live demo account.
const { calculate } = require('./emissions');

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

// Build Log documents for a user covering the start of the month (months - 1)
// ago up to the start of today (local time). Tagged details.synthetic = true.
function buildSampleLogs(userId, { months = 6, now = new Date(), seed = 20261020 } = {}) {
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const docs = generateEntries(start, end, makeRandom(seed)).map(({ category, input, date }) => {
        const { co2_impact, details, description } = calculate(category, input);
        return { user: userId, category, details: { ...details, synthetic: true }, description, co2_impact, date };
    });
    return { start, end, docs };
}

module.exports = { buildSampleLogs };
