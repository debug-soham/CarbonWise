// API integration tests. Run with `npm test`.
// Uses TEST_MONGODB_URI, or MONGODB_URI with the database renamed to
// "carbonwise_test". The test database is dropped when the run finishes.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

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
