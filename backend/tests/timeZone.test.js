// Unit tests for app time-zone helpers (Asia/Kolkata, UTC+05:30)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { APP_TIME_ZONE, dayKey, monthKey, dayBoundsUtc } = require('../timeZone');

test('app time zone is Asia/Kolkata', () => {
    assert.equal(APP_TIME_ZONE, 'Asia/Kolkata');
});

test('dayKey and monthKey use the app time zone', () => {
    // 19:00 UTC on 31 Oct is 00:30 on 1 Nov in India
    const lateUtc = new Date('2026-10-31T19:00:00Z');
    assert.equal(dayKey(lateUtc), '2026-11-01');
    assert.equal(monthKey(lateUtc), '2026-11');
    assert.equal(dayKey(new Date('2026-10-31T18:29:59Z')), '2026-10-31');
});

test('dayBoundsUtc spans the local calendar day', () => {
    const { start, end } = dayBoundsUtc(new Date('2026-10-20T03:00:00Z'));
    assert.equal(start.toISOString(), '2026-10-19T18:30:00.000Z');
    assert.equal(end.toISOString(), '2026-10-20T18:30:00.000Z');
});
