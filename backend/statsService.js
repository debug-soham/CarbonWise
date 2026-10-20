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
    // .lean() skips schema defaults, and accounts created before these fields
    // existed don't have them, so fill them in here
    return users.map(u => ({
        user: { stats_status: 'auto', flags_dismissed_at: null, ...u, id: String(u._id) },
        logs: logsByUser.get(String(u._id))
    }));
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

const PAGE_SIZE = 50;

function summary(user, logs) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        created_at: user.createdAt,
        entries: logs.length
    };
}

async function getFlaggedUsers(now = new Date()) {
    const accounts = await loadWithStatus(now);
    return accounts
        .filter(({ status }) => status === 'flagged')
        .map(({ user, logs }) => ({ user: summary(user, logs), flags: stats.computeFlags(user, logs, now) }));
}

// Newest accounts first; search matches name or email as plain text
async function listUsers({ search = '', status = '', page = 1 } = {}, now = new Date()) {
    const needle = String(search).trim().toLowerCase();
    const entries = await loadUsersWithLogs();

    const rows = entries
        .map(({ user, logs }) => ({
            ...summary(user, logs),
            last_active: logs.reduce((latest, log) => (!latest || log.date > latest ? log.date : latest), null),
            status: stats.userStatus(user, logs, now),
            is_demo: Boolean(user.is_demo)
        }))
        .filter(row => !needle || row.name.toLowerCase().includes(needle) || row.email.toLowerCase().includes(needle))
        .filter(row => !status || row.status === status)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const current = Math.min(Math.max(1, page), pages);
    return {
        users: rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
        page: current,
        pages,
        total: rows.length
    };
}

function invalidate() {
    cache = null;
}

module.exports = { STATUSES, loadUsersWithLogs, getPublicStats, getAdminOverview, getFlaggedUsers, listUsers, invalidate };
