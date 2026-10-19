// API integration tests. Run with `npm test`.
// Uses TEST_MONGODB_URI, or MONGODB_URI with the database renamed to
// "carbonwise_test". The test database is dropped when the run finishes.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
// Messy on purpose: admin emails are trimmed and compared case-insensitively
process.env.ADMIN_EMAILS = ' Admin@Example.com , other@x.com';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { connectDB } = require('../db');
const app = require('../app');

function testUri() {
    if (process.env.TEST_MONGODB_URI) return process.env.TEST_MONGODB_URI;
    const base = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/carbonwise';
    const url = new URL(base);
    url.pathname = '/carbonwise_test';
    return url.toString();
}

let server;
let baseUrl;

async function api(method, path, { body, token } = {}) {
    const res = await fetch(baseUrl + path, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, data: await res.json() };
}

async function registerUser(email) {
    const { status, data } = await api('POST', '/api/auth/register', {
        body: { name: 'Test User', email, password: 'password123' }
    });
    assert.equal(status, 201, JSON.stringify(data));
    return data.token;
}

const log = (token, body) => api('POST', '/api/logs', { token, body });

before(async () => {
    await connectDB(testUri());
    await mongoose.connection.db.dropDatabase();
    // Indexes were built before the drop; rebuild them
    await Promise.all(Object.values(mongoose.models).map(m => m.createIndexes()));
    server = app.listen(0);
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    server?.close();
    await mongoose.connection.db?.dropDatabase();
    await mongoose.disconnect();
});

// ---------- Auth ----------

test('register validates input', async () => {
    assert.equal((await api('POST', '/api/auth/register', {})).status, 400);
    assert.equal((await api('POST', '/api/auth/register', { body: { name: 'A', email: 'bad', password: 'password123' } })).status, 400);
    assert.equal((await api('POST', '/api/auth/register', { body: { name: 'A', email: 'a@b.co', password: 'short' } })).status, 400);
});

test('register, case-insensitive login, duplicate email', async () => {
    const reg = await api('POST', '/api/auth/register', {
        body: { name: ' Mixed Case ', email: 'Mixed@Example.com', password: 'password123' }
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.data.user.name, 'Mixed Case');
    assert.equal(reg.data.user.email, 'mixed@example.com');

    const login = await api('POST', '/api/auth/login', { body: { email: 'MIXED@example.com', password: 'password123' } });
    assert.equal(login.status, 200);

    const wrong = await api('POST', '/api/auth/login', { body: { email: 'mixed@example.com', password: 'wrongpass1' } });
    assert.equal(wrong.status, 401);

    const dup = await api('POST', '/api/auth/register', {
        body: { name: 'B', email: 'MIXED@example.com', password: 'password123' }
    });
    assert.equal(dup.status, 400);
});

test('protected routes reject missing and invalid tokens', async () => {
    assert.equal((await api('GET', '/api/auth/me')).status, 401);
    assert.equal((await api('GET', '/api/auth/me', { token: 'forged' })).status, 401);
});

test('monthly limit can be read and updated with validation', async () => {
    const token = await registerUser('limit@example.com');
    assert.equal((await api('GET', '/api/auth/me', { token })).data.user.monthly_limit, 400);
    assert.equal((await api('PUT', '/api/auth/me', { token, body: { monthly_limit: 'abc' } })).status, 400);
    assert.equal((await api('PUT', '/api/auth/me', { token, body: { monthly_limit: 0 } })).status, 400);
    assert.equal((await api('PUT', '/api/auth/me', { token, body: { monthly_limit: 250 } })).status, 200);
    assert.equal((await api('GET', '/api/logs/metrics', { token })).data.monthly_limit, 250);
});

// ---------- Footprint calculations ----------

test('energy: electricity, LPG, PNG and renewables', async () => {
    const token = await registerUser('energy@example.com');

    let r = await log(token, { category: 'energy', electricity: 100, lpg: 2, png: 1 });
    assert.equal(r.status, 201);
    assert.equal(r.data.log.co2_impact, Math.round((100 * 0.716 + 2 * 2.98 + 1 * 2.02) * 1000) / 1000);
    assert.match(r.data.log.description, /100 kWh electricity, 2 kg LPG, 1 m³ PNG/);

    r = await log(token, { category: 'energy', electricity: 100, renewable: true });
    assert.equal(r.data.log.co2_impact, 7.16);

    assert.equal((await log(token, { category: 'energy' })).status, 400);
    assert.equal((await log(token, { category: 'energy', electricity: -5 })).status, 400);
    assert.equal((await log(token, { category: 'energy', electricity: 'lots' })).status, 400);
});

test('transport: modes, shared car, validation', async () => {
    const token = await registerUser('transport@example.com');

    let r = await log(token, { category: 'transport', mode: 'bus', distance: 10 });
    assert.equal(r.data.log.co2_impact, 1.02);

    r = await log(token, { category: 'transport', mode: 'car_petrol', distance: 100, passengers: 4 });
    assert.equal(r.data.log.co2_impact, 4.1);
    assert.match(r.data.log.description, /shared by 4/);

    // Passengers only divide car emissions
    r = await log(token, { category: 'transport', mode: 'bus', distance: 10, passengers: 4 });
    assert.equal(r.data.log.co2_impact, 1.02);

    r = await log(token, { category: 'transport', mode: 'walk_cycle', distance: 5 });
    assert.equal(r.data.log.co2_impact, 0);

    assert.equal((await log(token, { category: 'transport', mode: 'rocket', distance: 10 })).status, 400);
    assert.equal((await log(token, { category: 'transport', mode: 'toString', distance: 10 })).status, 400);
    assert.equal((await log(token, { category: 'transport', mode: 'bus' })).status, 400);
    assert.equal((await log(token, { category: 'transport', mode: 'car_petrol', distance: 10, passengers: 1.5 })).status, 400);
});

test('food and shopping', async () => {
    const token = await registerUser('lifestyle@example.com');

    let r = await log(token, { category: 'food', meal: 'beef_lamb', count: 2 });
    assert.equal(r.data.log.co2_impact, 14);

    r = await log(token, { category: 'shopping', item: 'jeans', quantity: 1 });
    assert.equal(r.data.log.co2_impact, 33);

    assert.equal((await log(token, { category: 'food', meal: 'vegan', count: 0 })).status, 400);
    assert.equal((await log(token, { category: 'food', meal: 'vegan', count: 1.5 })).status, 400);
    assert.equal((await log(token, { category: 'shopping', item: 'yacht', quantity: 1 })).status, 400);
    assert.equal((await log(token, { category: 'unknown' })).status, 400);
    assert.equal((await log(token, {})).status, 400);
});

test('factors endpoint exposes the catalogue', async () => {
    const token = await registerUser('factors@example.com');
    const r = await api('GET', '/api/logs/factors', { token });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.data.factors), ['energy', 'transport', 'food', 'shopping']);
    assert.equal(r.data.factors.transport.bus.factor, 0.102);
});

// ---------- Dates, history, metrics ----------

test('backdated logs, future dates rejected', async () => {
    const token = await registerUser('dates@example.com');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const r = await log(token, { category: 'food', meal: 'vegan', count: 1, date: yesterday });
    assert.equal(r.status, 201);
    assert.equal(r.data.log.date, yesterday);

    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal((await log(token, { category: 'food', meal: 'vegan', count: 1, date: future })).status, 400);
    assert.equal((await log(token, { category: 'food', meal: 'vegan', count: 1, date: 'not-a-date' })).status, 400);
    assert.equal((await log(token, { category: 'food', meal: 'vegan', count: 1, date: '2001-01-01' })).status, 400);
});

test('metrics are scoped to the requested range', async () => {
    const token = await registerUser('metrics@example.com');
    const lastMonth = new Date();
    lastMonth.setUTCDate(1);
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);

    await log(token, { category: 'transport', mode: 'bus', distance: 10 });          // 1.02 now
    await log(token, { category: 'food', meal: 'beef_lamb', count: 1 });              // 7 now
    await log(token, { category: 'shopping', item: 'laptop', quantity: 1, date: lastMonth.toISOString() }); // 250 last month

    const current = await api('GET', '/api/logs/metrics', { token });
    assert.equal(current.status, 200);
    assert.equal(current.data.total, '8.02');
    assert.equal(current.data.count, 2);
    assert.equal(current.data.breakdown.shopping, 0);

    const from = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth(), 1)).toISOString();
    const to = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() + 1, 1)).toISOString();
    const previous = await api('GET', `/api/logs/metrics?from=${from}&to=${to}`, { token });
    assert.equal(previous.data.total, '250.00');
    assert.equal(previous.data.breakdown.shopping, 250);

    assert.equal((await api('GET', '/api/logs/metrics?from=bad', { token })).status, 400);
    assert.equal((await api('GET', `/api/logs/metrics?from=${to}&to=${from}`, { token })).status, 400);
});

test('series groups by day and month in the requested time zone', async () => {
    const token = await registerUser('series@example.com');

    // 20:00 UTC yesterday is already "today" in India (UTC+05:30)
    const now = new Date();
    const lateEvening = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 20));
    const utcDay = lateEvening.toISOString().slice(0, 10);
    const istDay = new Date(lateEvening.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await log(token, { category: 'food', meal: 'vegan', count: 2, date: lateEvening.toISOString() });      // 1.0
    await log(token, { category: 'transport', mode: 'bus', distance: 10, date: lateEvening.toISOString() }); // 1.02

    const from = new Date(lateEvening.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(lateEvening.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const range = `from=${from}&to=${to}`;

    let r = await api('GET', `/api/logs/series?${range}&unit=day`, { token });
    assert.equal(r.status, 200);
    assert.equal(r.data.timezone, 'UTC');
    assert.equal(r.data.series.length, 1);
    assert.equal(r.data.series[0].period, utcDay);
    assert.equal(r.data.series[0].count, 2);
    assert.equal(Math.round(r.data.series[0].total * 100) / 100, 2.02);
    assert.equal(r.data.series[0].breakdown.food, 1);

    r = await api('GET', `/api/logs/series?${range}&unit=day&tz=Asia/Kolkata`, { token });
    assert.equal(r.data.series[0].period, istDay);

    r = await api('GET', `/api/logs/series?${range}&unit=month&tz=Asia/Kolkata`, { token });
    assert.equal(r.data.series[0].period, istDay.slice(0, 7));

    assert.equal((await api('GET', `/api/logs/series?${range}&unit=year`, { token })).status, 400);
    assert.equal((await api('GET', `/api/logs/series?${range}&tz=Mars/Base`, { token })).status, 400);
    assert.equal((await api('GET', `/api/logs/series?from=2025-01-01&to=2026-12-31`, { token })).status, 400);
});

test('history lists own logs newest first, filters, and deletes', async () => {
    const token = await registerUser('history@example.com');
    const other = await registerUser('other@example.com');
    const older = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    await log(token, { category: 'food', meal: 'vegan', count: 1, date: older });
    const newest = (await log(token, { category: 'transport', mode: 'train', distance: 20 })).data.log;
    const othersLog = (await log(other, { category: 'food', meal: 'fish', count: 1 })).data.log;

    let r = await api('GET', '/api/logs', { token });
    assert.equal(r.data.logs.length, 2);
    assert.equal(r.data.logs[0].id, newest.id);

    r = await api('GET', '/api/logs?category=food', { token });
    assert.equal(r.data.logs.length, 1);
    assert.equal((await api('GET', '/api/logs?category=nope', { token })).status, 400);

    // Cannot delete another user's log
    assert.equal((await api('DELETE', `/api/logs/${othersLog.id}`, { token })).status, 404);
    assert.equal((await api('DELETE', '/api/logs/not-an-id', { token })).status, 404);

    assert.equal((await api('DELETE', `/api/logs/${newest.id}`, { token })).status, 200);
    assert.equal((await api('DELETE', `/api/logs/${newest.id}`, { token })).status, 404);
    assert.equal((await api('GET', '/api/logs', { token })).data.logs.length, 1);
    assert.equal((await api('GET', '/api/logs', { token: other })).data.logs.length, 1);
});

// ---------- Profile and demo ----------

test('name can be updated with validation', async () => {
    const token = await registerUser('rename@example.com');

    let r = await api('PUT', '/api/auth/me', { token, body: { name: '  New Name  ' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.user.name, 'New Name');
    assert.equal((await api('GET', '/api/auth/me', { token })).data.user.name, 'New Name');

    assert.equal((await api('PUT', '/api/auth/me', { token, body: { name: '   ' } })).status, 400);
    assert.equal((await api('PUT', '/api/auth/me', { token, body: { name: 'x'.repeat(61) } })).status, 400);
    assert.equal((await api('PUT', '/api/auth/me', { token, body: {} })).status, 400);

    // Both fields at once
    r = await api('PUT', '/api/auth/me', { token, body: { name: 'Both', monthly_limit: 300 } });
    assert.equal(r.data.user.name, 'Both');
    assert.equal(r.data.user.monthly_limit, 300);
});

test('demo account: sample history, read-only, one shared user', async () => {
    const first = await api('POST', '/api/auth/demo');
    assert.equal(first.status, 200);
    assert.equal(first.data.user.is_demo, true);
    const token = first.data.token;

    // Six months of history up to yesterday
    const history = await api('GET', '/api/logs?limit=200', { token });
    assert.ok(history.data.logs.length > 100, `got ${history.data.logs.length} logs`);
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    assert.ok(history.data.logs.every(l => new Date(l.date) < startOfToday));
    assert.equal((await api('GET', '/api/auth/me', { token })).data.user.is_demo, true);

    // Writes are blocked
    const blocked = [
        await api('POST', '/api/logs', { token, body: { category: 'food', meal: 'vegan', count: 1 } }),
        await api('DELETE', `/api/logs/${history.data.logs[0].id}`, { token }),
        await api('PUT', '/api/auth/me', { token, body: { monthly_limit: 1 } })
    ];
    blocked.forEach(r => {
        assert.equal(r.status, 403);
        assert.match(r.data.message, /read-only/);
    });

    // Concurrent demo sign-ins share one user and don't duplicate data
    const [a, b] = await Promise.all([api('POST', '/api/auth/demo'), api('POST', '/api/auth/demo')]);
    assert.equal(a.data.user.id, first.data.user.id);
    assert.equal(b.data.user.id, first.data.user.id);
    const again = await api('GET', '/api/logs?limit=200', { token });
    assert.equal(again.data.logs.length, history.data.logs.length);

    // Nobody can register the reserved demo address
    const squat = await api('POST', '/api/auth/register', { body: { name: 'X', email: 'demo@carbonwise.invalid', password: 'password123' } });
    assert.equal(squat.status, 400);
});

test('stale demo data is regenerated up to yesterday', async () => {
    const { token, user } = (await api('POST', '/api/auth/demo')).data;
    const Log = mongoose.model('Log');

    // Simulate a demo last refreshed a week ago
    await Log.deleteMany({ user: user.id, date: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } });
    const before = await Log.findOne({ user: user.id }).sort({ date: -1 });
    assert.ok(before.date < new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));

    await api('POST', '/api/auth/demo');
    const after = await Log.findOne({ user: user.id }).sort({ date: -1 });
    const startOfYesterday = new Date(); startOfYesterday.setHours(0, 0, 0, 0); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    assert.ok(after.date >= startOfYesterday, `newest demo log ${after.date.toISOString()}`);
    assert.equal((await api('GET', '/api/auth/me', { token })).status, 200);
});

// ---------- Input limits ----------

test('input limits are enforced per entry', async () => {
    const token = await registerUser('limits@example.com');
    const rejected = [
        { category: 'energy', electricity: 2001 },
        { category: 'energy', lpg: 31 },
        { category: 'energy', png: 301 },
        { category: 'transport', mode: 'bus', distance: 2001 },
        { category: 'transport', mode: 'flight', distance: 20001 },
        { category: 'food', meal: 'vegan', count: 11 },
        { category: 'shopping', item: 'book', quantity: 21 }
    ];
    for (const body of rejected) {
        const r = await log(token, body);
        assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(body)}, got ${r.status}`);
    }
    assert.equal((await log(token, { category: 'transport', mode: 'flight', distance: 20000 })).status, 201);
    assert.equal((await log(token, { category: 'energy', electricity: 2000 })).status, 201);
});

test('at most 50 entries per day', async () => {
    const token = await registerUser('daily-cap@example.com');
    const now = new Date();
    const yesterdayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString();
    const entry = { category: 'food', meal: 'vegan', count: 1, date: yesterdayNoon };

    const results = await Promise.all(Array.from({ length: 50 }, () => log(token, entry)));
    assert.ok(results.every(r => r.status === 201), 'first 50 entries accepted');

    const over = await log(token, entry);
    assert.equal(over.status, 429);
    assert.equal(over.data.message, 'You can log at most 50 entries per day.');

    // A different day is unaffected
    assert.equal((await log(token, { category: 'food', meal: 'vegan', count: 1 })).status, 201);
});

// ---------- Public stats ----------

const statsService = require('../statsService');

// Mongoose timestamps protect createdAt, so age accounts through the raw driver
async function ageAccount(email, days) {
    await mongoose.connection.collection('users').updateOne(
        { email },
        { $set: { createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } }
    );
}

// 5 entries of 2 kg (4 vegan meals) on 5 distinct days last month = 10 kg
async function logLastMonth(token) {
    const now = new Date();
    for (let day = 2; day <= 6; day++) {
        const date = new Date(now.getFullYear(), now.getMonth() - 1, day, 12).toISOString();
        const r = await log(token, { category: 'food', meal: 'vegan', count: 4, date });
        assert.equal(r.status, 201);
    }
}

test('public stats count only eligible, unflagged, non-demo users', async () => {
    statsService.invalidate();
    const a = await registerUser('stats-a@example.com');
    const b = await registerUser('stats-b@example.com');
    const c = await registerUser('stats-c@example.com');
    for (const token of [a, b, c]) await logLastMonth(token);
    await ageAccount('stats-a@example.com', 30);
    await ageAccount('stats-b@example.com', 3);
    await ageAccount('stats-c@example.com', 30);
    await mongoose.connection.collection('users').updateOne({ email: 'stats-c@example.com' }, { $set: { stats_status: 'excluded' } });
    await api('POST', '/api/auth/demo');

    const r = await api('GET', '/api/stats/public');
    assert.equal(r.status, 200);
    assert.equal(r.data.total_tonnes, 0.01);
    assert.ok(!Number.isNaN(Date.parse(r.data.updated_at)));
});

test('trusted users count immediately', async () => {
    await mongoose.connection.collection('users').updateOne({ email: 'stats-b@example.com' }, { $set: { stats_status: 'trusted' } });
    statsService.invalidate();
    assert.equal((await api('GET', '/api/stats/public')).data.total_tonnes, 0.02);
});

test('public stats are cached', async () => {
    const first = await api('GET', '/api/stats/public');
    const userA = await mongoose.connection.collection('users').findOne({ email: 'stats-a@example.com' });
    await mongoose.model('Log').create({ user: userA._id, category: 'food', co2_impact: 1000, date: new Date() });
    const second = await api('GET', '/api/stats/public');
    assert.equal(second.data.updated_at, first.data.updated_at);
    assert.equal(second.data.total_tonnes, first.data.total_tonnes);
});

// ---------- Admin ----------

test('admin routes need an admin', async () => {
    assert.equal((await api('GET', '/api/admin/overview')).status, 401);

    const user = await registerUser('not-admin@example.com');
    assert.equal((await api('GET', '/api/admin/overview', { token: user })).status, 403);
    assert.equal((await api('GET', '/api/auth/me', { token: user })).data.user.is_admin, false);

    const demo = (await api('POST', '/api/auth/demo')).data.token;
    assert.equal((await api('GET', '/api/admin/overview', { token: demo })).status, 403);

    const admin = await registerUser('admin@example.com');
    assert.equal((await api('GET', '/api/auth/me', { token: admin })).data.user.is_admin, true);
    const overview = await api('GET', '/api/admin/overview', { token: admin });
    assert.equal(overview.status, 200);
    assert.deepEqual(Object.keys(overview.data.counts).sort(), ['counted', 'excluded', 'flagged', 'new', 'trusted', 'users']);
    assert.equal(typeof overview.data.public.total_tonnes, 'number');
    assert.equal(typeof overview.data.raw.total_tonnes, 'number');
    // Raw ignores caps and eligibility, so it is never below the public figure
    assert.ok(overview.data.raw.total_tonnes >= overview.data.public.total_tonnes);

    const saved = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = '';
    try {
        assert.equal((await api('GET', '/api/admin/overview', { token: admin })).status, 403);
    } finally {
        process.env.ADMIN_EMAILS = saved;
    }
});

async function adminToken() {
    const r = await api('POST', '/api/auth/login', { body: { email: 'admin@example.com', password: 'password123' } });
    assert.equal(r.status, 200);
    return r.data.token;
}

test('admin can exclude, trust, reset and dismiss', async () => {
    const admin = await adminToken();
    statsService.invalidate();
    const before = (await api('GET', '/api/stats/public')).data.total_tonnes;

    const userA = await mongoose.connection.collection('users').findOne({ email: 'stats-a@example.com' });
    const id = String(userA._id);

    let r = await api('PATCH', `/api/admin/users/${id}`, { token: admin, body: { stats_status: 'excluded' } });
    assert.equal(r.status, 200);
    const listed = (await api('GET', '/api/admin/users?search=stats-a', { token: admin })).data.users;
    assert.equal(listed[0].status, 'excluded');
    // The cache was cleared, so the public figure drops straight away
    assert.ok((await api('GET', '/api/stats/public')).data.total_tonnes < before);

    assert.equal((await api('PATCH', `/api/admin/users/${id}`, { token: admin, body: { stats_status: 'bogus' } })).status, 400);
    assert.equal((await api('PATCH', `/api/admin/users/${id}`, { token: admin, body: { stats_status: 'trusted' } })).status, 200);
    assert.equal((await api('PATCH', `/api/admin/users/${id}`, { token: admin, body: { stats_status: 'auto' } })).status, 200);

    const demoUser = await mongoose.connection.collection('users').findOne({ is_demo: true });
    const demoPatch = await api('PATCH', `/api/admin/users/${demoUser._id}`, { token: admin, body: { stats_status: 'trusted' } });
    assert.equal(demoPatch.status, 400);
    assert.equal(demoPatch.data.message, "The demo account's status can't be changed");

    assert.equal((await api('PATCH', '/api/admin/users/not-an-id', { token: admin, body: { stats_status: 'auto' } })).status, 404);
    assert.equal((await api('PATCH', '/api/admin/users/64b000000000000000000000', { token: admin, body: { stats_status: 'auto' } })).status, 404);

    assert.equal((await api('POST', `/api/admin/users/${id}/dismiss-flags`, { token: admin })).status, 200);
    const after = await mongoose.connection.collection('users').findOne({ _id: userA._id });
    assert.ok(after.flags_dismissed_at instanceof Date);
});

test('flag queue lists a backdate burst', async () => {
    const admin = await adminToken();
    await registerUser('burst@example.com');
    await ageAccount('burst@example.com', 30);
    const burstUser = await mongoose.connection.collection('users').findOne({ email: 'burst@example.com' });
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await mongoose.connection.collection('logs').insertMany(Array.from({ length: 60 }, () => ({
        user: burstUser._id, category: 'food', details: {}, description: '', co2_impact: 0.5, date: tenDaysAgo, createdAt: new Date()
    })));

    const flags = (await api('GET', '/api/admin/flags', { token: admin })).data;
    const entry = flags.find(f => f.user.email === 'burst@example.com');
    assert.ok(entry, 'burst user is in the flag queue');
    assert.equal(entry.flags[0].code, 'backdate_burst');
    assert.equal(entry.user.entries, 60);
    assert.ok((await api('GET', '/api/admin/overview', { token: admin })).data.counts.flagged >= 1);
});

test('user search and filter', async () => {
    const admin = await adminToken();
    let r = await api('GET', '/api/admin/users?search=MIXED', { token: admin });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.users.map(u => u.email), ['mixed@example.com']);
    assert.equal(r.data.page, 1);

    r = await api('GET', '/api/admin/users?search=a%2Bb(', { token: admin });
    assert.equal(r.status, 200);

    await api('PATCH', `/api/admin/users/${(await mongoose.connection.collection('users').findOne({ email: 'stats-c@example.com' }))._id}`, { token: admin, body: { stats_status: 'excluded' } });
    r = await api('GET', '/api/admin/users?status=excluded', { token: admin });
    assert.ok(r.data.users.length >= 1);
    assert.ok(r.data.users.every(u => u.status === 'excluded'));

    assert.equal((await api('GET', '/api/admin/users?status=nope', { token: admin })).status, 400);

    // Rows carry what the admin table shows; the demo row is marked
    const all = (await api('GET', '/api/admin/users', { token: admin })).data;
    const row = all.users.find(u => u.email === 'stats-a@example.com');
    assert.deepEqual(Object.keys(row).sort(), ['created_at', 'email', 'entries', 'id', 'is_demo', 'last_active', 'name', 'status']);
    assert.equal(row.entries, 6);
    assert.ok(all.users.some(u => u.is_demo && u.status === 'demo'));
});
