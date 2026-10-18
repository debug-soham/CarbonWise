// Unit tests for the public-statistics rules. Pure: no database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const stats = require('../stats');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-20T06:30:00Z');

let nextId = 1;
function mkUser(overrides = {}) {
    return {
        id: String(nextId++),
        createdAt: new Date(NOW.getTime() - 60 * DAY),
        stats_status: 'auto',
        is_demo: false,
        monthly_limit: 400,
        flags_dismissed_at: null,
        ...overrides
    };
}

// A log dated at `iso`; created at the same moment unless overridden
function mkLog(iso, kg, overrides = {}) {
    const date = new Date(iso);
    return { date, createdAt: date, co2_impact: kg, category: 'food', details: {}, ...overrides };
}

// `days` logs on consecutive days of a month, splitting `total` evenly
function monthLogs(yearMonth, total, days = 5) {
    return Array.from({ length: days }, (_, i) =>
        mkLog(`${yearMonth}-${String(i + 2).padStart(2, '0')}T06:30:00Z`, total / days));
}

function activeDays(n, start = '2026-09-01') {
    const first = new Date(`${start}T06:30:00Z`).getTime();
    return Array.from({ length: n }, (_, i) => mkLog(new Date(first + i * DAY).toISOString(), 1));
}

const metrics = (entries, capped = true, now = NOW) => stats.computeMetrics(entries, { capped, now });

// ---------- Eligibility and status ----------

test('eligibility needs a 14-day-old account', () => {
    const logs = activeDays(10);
    assert.equal(stats.isEligible(mkUser({ createdAt: new Date(NOW.getTime() - 13 * DAY) }), logs, NOW), false);
    assert.equal(stats.isEligible(mkUser({ createdAt: new Date(NOW.getTime() - 14 * DAY) }), logs, NOW), true);
});

test('eligibility needs 5 distinct active days', () => {
    assert.equal(stats.isEligible(mkUser(), activeDays(4), NOW), false);
    assert.equal(stats.isEligible(mkUser(), activeDays(5), NOW), true);
    // Several entries on the same day count once
    const sameDay = [...activeDays(4), mkLog('2026-09-01T10:00:00Z', 1)];
    assert.equal(stats.isEligible(mkUser(), sameDay, NOW), false);
});

test('userStatus precedence', () => {
    const spiky = [...monthLogs('2026-05', 100), ...monthLogs('2026-06', 100), ...monthLogs('2026-07', 100), ...monthLogs('2026-08', 401)];
    assert.equal(stats.userStatus(mkUser({ is_demo: true, stats_status: 'trusted' }), spiky, NOW), 'demo');
    assert.equal(stats.userStatus(mkUser({ stats_status: 'trusted' }), spiky, NOW), 'trusted');
    assert.equal(stats.userStatus(mkUser({ stats_status: 'excluded' }), activeDays(10), NOW), 'excluded');
    assert.equal(stats.userStatus(mkUser(), spiky, NOW), 'flagged');
    assert.equal(stats.userStatus(mkUser(), activeDays(10), NOW), 'counted');
    assert.equal(stats.userStatus(mkUser(), activeDays(3), NOW), 'new');
});

// ---------- Total CO2 ----------

test('monthly totals are capped at 2,000 kg when capped', () => {
    const entries = [{ user: mkUser(), logs: [mkLog('2026-09-10T06:30:00Z', 2500)] }];
    assert.equal(metrics(entries, true).total_tonnes, 2);
    assert.equal(metrics(entries, false).total_tonnes, 2.5);
});

test('empty input gives zero and nulls', () => {
    assert.deepEqual(metrics([]), { total_tonnes: 0, change_pct: null, green_days_pct: null });
    assert.deepEqual(metrics([{ user: mkUser(), logs: [] }]), { total_tonnes: 0, change_pct: null, green_days_pct: null });
});

// ---------- Footprint change ----------

function changeUser(may, june, july, julyDays = 5) {
    return {
        user: mkUser(),
        logs: [...monthLogs('2026-05', may), ...monthLogs('2026-06', june), ...monthLogs('2026-07', july, julyDays)]
    };
}

test('change compares the latest complete month with the first two', () => {
    // October (current) entries must not count as a complete month
    const entry = changeUser(400, 400, 300);
    entry.logs.push(...monthLogs('2026-10', 10, 10));
    assert.equal(metrics([entry]).change_pct, -25);
});

test('a month with fewer than 5 active days is not complete', () => {
    assert.equal(metrics([changeUser(400, 400, 300, 4)]).change_pct, null);
});

test('change is the median across users', () => {
    assert.equal(metrics([changeUser(400, 400, 300), changeUser(400, 400, 440)]).change_pct, -7.5);
    assert.equal(metrics([changeUser(400, 400, 300), changeUser(400, 400, 360), changeUser(400, 400, 440)]).change_pct, -10);
});

// ---------- Green days ----------

test('a green day stays within limit ÷ days in month', () => {
    const user = mkUser({ monthly_limit: 310 });
    const logs = [mkLog('2026-10-05T06:30:00Z', 10), mkLog('2026-10-06T06:30:00Z', 10.01)];
    assert.equal(metrics([{ user, logs }]).green_days_pct, 50);
    // June has 30 days: budget 10.33 kg
    assert.equal(metrics([{ user, logs: [mkLog('2026-06-05T06:30:00Z', 10.2)] }]).green_days_pct, 100);
});

test('a missing or zero monthly limit falls back to 400', () => {
    // October budget at 400 kg is 12.9 kg/day
    const logs = [mkLog('2026-10-05T06:30:00Z', 12), mkLog('2026-10-06T06:30:00Z', 13)];
    assert.equal(metrics([{ user: mkUser({ monthly_limit: 0 }), logs }]).green_days_pct, 50);
    assert.equal(metrics([{ user: mkUser({ monthly_limit: undefined }), logs }]).green_days_pct, 50);
});

test('days and months are grouped in India time', () => {
    // 19:00 UTC on 31 Oct is 1 Nov in India. Limit 3,000: Oct budget 96.8, Nov budget 100
    const user = mkUser({ monthly_limit: 3000 });
    const logs = [mkLog('2026-10-31T19:00:00Z', 98)];
    assert.equal(metrics([{ user, logs }], true, new Date('2026-12-01T00:00:00Z')).green_days_pct, 100);
});

// ---------- Flags ----------

const codes = (flags) => flags.map(f => f.code);

test('spike: a month over 4× the median month and over 300 kg', () => {
    const base = [...monthLogs('2026-05', 100), ...monthLogs('2026-06', 100), ...monthLogs('2026-07', 100)];
    assert.deepEqual(codes(stats.computeFlags(mkUser(), [...base, ...monthLogs('2026-08', 401)], NOW)), ['spike']);
    assert.deepEqual(stats.computeFlags(mkUser(), [...base, ...monthLogs('2026-08', 400)], NOW), []);
    // Needs 3 months of history
    assert.deepEqual(stats.computeFlags(mkUser(), [...monthLogs('2026-07', 50), ...monthLogs('2026-08', 401)], NOW), []);
});

test('spike message', () => {
    const logs = [...monthLogs('2026-06', 297), ...monthLogs('2026-07', 297), ...monthLogs('2026-08', 297), ...monthLogs('2026-09', 1840)];
    const [flag] = stats.computeFlags(mkUser(), logs, NOW);
    assert.equal(flag.message, "Sep 2026 is 6.2× this user's typical month (1,840 kg vs 297 kg)");
});

function burst(count, backdateDays, createdIso = '2026-10-21T04:00:00Z') {
    const first = new Date(createdIso).getTime();
    return Array.from({ length: count }, (_, i) => {
        const createdAt = new Date(first + i * 60 * 1000);
        return mkLog(new Date(createdAt.getTime() - backdateDays * DAY).toISOString(), 1, { createdAt });
    });
}

test('backdate_burst: 60+ backdated entries created within 24 hours', () => {
    assert.deepEqual(codes(stats.computeFlags(mkUser(), burst(60, 8), NOW)), ['backdate_burst']);
    assert.deepEqual(stats.computeFlags(mkUser(), burst(59, 8), NOW), []);
    assert.deepEqual(stats.computeFlags(mkUser(), burst(60, 6), NOW), []);
    const [flag] = stats.computeFlags(mkUser(), burst(142, 8), NOW);
    assert.equal(flag.message, '142 backdated entries added on 21 Oct 2026');
});

test('at_limits: 5+ recent entries at 90% of an input limit', () => {
    const near = (n) => Array.from({ length: n }, (_, i) =>
        mkLog(new Date(NOW.getTime() - (i + 1) * DAY).toISOString(), 1, { category: 'energy', details: { electricity: 1800 } }));
    const flags = stats.computeFlags(mkUser(), near(5), NOW);
    assert.deepEqual(codes(flags), ['at_limits']);
    assert.equal(flags[0].message, '5 entries near the input limits in the last 30 days');
    assert.deepEqual(stats.computeFlags(mkUser(), near(4), NOW), []);
    // Flights are measured against the flight limit: 1,900 km is far below 20,000
    const flights = Array.from({ length: 5 }, (_, i) =>
        mkLog(new Date(NOW.getTime() - (i + 1) * DAY).toISOString(), 1, { category: 'transport', details: { mode: 'flight', distance: 1900 } }));
    assert.deepEqual(stats.computeFlags(mkUser(), flights, NOW), []);
});

test('over_cap: a month above 2,000 kg', () => {
    const flags = stats.computeFlags(mkUser(), monthLogs('2026-08', 2450), NOW);
    assert.deepEqual(codes(flags), ['over_cap']);
    assert.equal(flags[0].message, 'Aug 2026 totals 2,450 kg (cap 2,000)');
});

test('dismissed entries no longer raise flags; other statuses are never flagged', () => {
    const logs = [...monthLogs('2026-05', 100), ...monthLogs('2026-06', 100), ...monthLogs('2026-07', 100), ...monthLogs('2026-08', 401)];
    assert.deepEqual(stats.computeFlags(mkUser({ flags_dismissed_at: new Date('2026-09-01T00:00:00Z') }), logs, NOW), []);
    assert.deepEqual(stats.computeFlags(mkUser({ stats_status: 'trusted' }), logs, NOW), []);
    assert.deepEqual(stats.computeFlags(mkUser({ stats_status: 'excluded' }), logs, NOW), []);
    assert.deepEqual(stats.computeFlags(mkUser({ is_demo: true }), logs, NOW), []);
});
