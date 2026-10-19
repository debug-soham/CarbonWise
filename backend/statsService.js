// Loads users and their logs from MongoDB and applies the rules in stats.js.
// The public figures are cached; admin changes call invalidate().
const User = require('./models/User');
const Log = require('./models/Log');
const stats = require('./stats');

let cache = null; // { value, expires }

async function loadUsersWithLogs() {
    const [users, logs] = await Promise.all([
        User.find().lean(),
        Log.find({}, 'user date createdAt co2_impact category details').lean()
    ]);

    const logsByUser = new Map(users.map(u => [String(u._id), []]));
    for (const log of logs) {
        const list = logsByUser.get(String(log.user));
        if (list) list.push(log);
    }
    return users.map(u => ({ user: { ...u, id: String(u._id) }, logs: logsByUser.get(String(u._id)) }));
}

const isCounted = (status) => status === 'trusted' || status === 'counted';

async function getPublicStats(now = new Date()) {
    if (cache && cache.expires > now.getTime()) return cache.value;

    const entries = await loadUsersWithLogs();
    const counted = entries.filter(({ user, logs }) => isCounted(stats.userStatus(user, logs, now)));
    const value = { ...stats.computeMetrics(counted, { capped: true, now }), updated_at: now.toISOString() };

    cache = { value, expires: now.getTime() + stats.CACHE_TTL_MS };
    return value;
}

const STATUSES = ['counted', 'new', 'flagged', 'excluded', 'trusted'];

// Every account except the demo, with its status computed once
async function loadWithStatus(now) {
    const entries = await loadUsersWithLogs();
    return entries
        .filter(({ user }) => !user.is_demo)
        .map(entry => ({ ...entry, status: stats.userStatus(entry.user, entry.logs, now) }));
}

async function getAdminOverview(now = new Date()) {
    const accounts = await loadWithStatus(now);
    const counts = { users: accounts.length, ...Object.fromEntries(STATUSES.map(s => [s, 0])) };
    accounts.forEach(({ status }) => { counts[status]++; });

    return {
        public: await getPublicStats(now),
        // No cap, no eligibility, no exclusions (the demo is still left out)
        raw: stats.computeMetrics(accounts, { capped: false, now }),
        counts
    };
}

function invalidate() {
    cache = null;
}

module.exports = { STATUSES, loadUsersWithLogs, getPublicStats, getAdminOverview, invalidate };
