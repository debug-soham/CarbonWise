// Rules behind the public impact figures and the fake-data flags.
// Pure functions over plain objects (no database) so every rule is unit-tested.
//
//   user = { id, createdAt, stats_status, is_demo, monthly_limit, flags_dismissed_at }
//   log  = { date, createdAt, co2_impact, category, details }
const { dayKey, monthKey } = require('./timeZone');
const { LIMITS } = require('./emissions');

const DAY_MS = 24 * 60 * 60 * 1000;

const MIN_ACCOUNT_AGE_DAYS = 14;
const MIN_ACTIVE_DAYS = 5;
const MONTHLY_CAP_KG = 2000;
const COMPLETE_MONTH_MIN_DAYS = 5;
const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MONTHLY_LIMIT = 400;

// Flag thresholds (spec section 4)
const SPIKE_RATIO = 4;
const SPIKE_MIN_KG = 300;
const SPIKE_MIN_MONTHS = 3;
const BURST_MIN_ENTRIES = 60;
const BURST_BACKDATE_DAYS = 7;
const NEAR_LIMIT_SHARE = 0.9;
const NEAR_LIMIT_MIN_ENTRIES = 5;
const NEAR_LIMIT_WINDOW_DAYS = 30;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM' -> 'Sep 2026'
function formatMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return `${MONTH_NAMES[m - 1]} ${y}`;
}

// 'YYYY-MM-DD' -> '21 Oct 2026'
function formatDay(key) {
    const [y, m, d] = key.split('-').map(Number);
    return `${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

const formatKg = (kg) => Math.round(kg).toLocaleString('en-US');

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

function daysInMonth(key) {
    const [y, m] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Map of 'YYYY-MM' -> { total, days: Set of day keys }
function groupByMonth(logs) {
    const months = new Map();
    for (const log of logs) {
        const key = monthKey(log.date);
        if (!months.has(key)) months.set(key, { total: 0, days: new Set() });
        const month = months.get(key);
        month.total += log.co2_impact;
        month.days.add(dayKey(log.date));
    }
    return months;
}

function activeDayCount(logs) {
    return new Set(logs.map(log => dayKey(log.date))).size;
}

// Account age and activity only; flags and status are handled by userStatus
function isEligible(user, logs, now) {
    const ageMs = now.getTime() - new Date(user.createdAt).getTime();
    return ageMs >= MIN_ACCOUNT_AGE_DAYS * DAY_MS && activeDayCount(logs) >= MIN_ACTIVE_DAYS;
}

// The input values of an entry that sit at 90%+ of their per-entry limit
function isNearLimits(details = {}) {
    const limitFor = {
        electricity: LIMITS.electricity,
        lpg: LIMITS.lpg,
        png: LIMITS.png,
        distance: details.mode === 'flight' ? LIMITS.flightDistance : LIMITS.distance,
        count: LIMITS.count,
        quantity: LIMITS.quantity
    };
    return Object.entries(limitFor).some(([key, limit]) =>
        typeof details[key] === 'number' && details[key] >= NEAR_LIMIT_SHARE * limit);
}

function computeFlags(user, logs, now) {
    if (user.is_demo || user.stats_status !== 'auto') return [];

    // Only entries created after the last dismissal can raise a flag
    const dismissedAt = user.flags_dismissed_at ? new Date(user.flags_dismissed_at).getTime() : -Infinity;
    const evaluated = logs.filter(log => new Date(log.createdAt).getTime() > dismissedAt);
    if (evaluated.length === 0) return [];

    const flags = [];
    const allMonths = groupByMonth(logs);
    const evaluatedMonths = groupByMonth(evaluated);

    // spike: a month far above this user's typical month
    if (allMonths.size >= SPIKE_MIN_MONTHS) {
        const typical = median([...allMonths.values()].map(m => m.total));
        for (const [key, { total }] of evaluatedMonths) {
            if (total > SPIKE_RATIO * typical && total > SPIKE_MIN_KG) {
                flags.push({
                    code: 'spike',
                    message: `${formatMonth(key)} is ${(total / typical).toFixed(1)}× this user's typical month (${formatKg(total)} kg vs ${formatKg(typical)} kg)`
                });
            }
        }
    }

    // backdate_burst: many old-dated entries created within 24 hours
    const backdated = evaluated
        .filter(log => new Date(log.createdAt) - new Date(log.date) > BURST_BACKDATE_DAYS * DAY_MS)
        .map(log => new Date(log.createdAt).getTime())
        .sort((a, b) => a - b);
    let best = { count: 0, start: 0 };
    for (let i = 0, j = 0; j < backdated.length; j++) {
        while (backdated[j] - backdated[i] >= DAY_MS) i++;
        if (j - i + 1 > best.count) best = { count: j - i + 1, start: backdated[i] };
    }
    if (best.count >= BURST_MIN_ENTRIES) {
        flags.push({
            code: 'backdate_burst',
            message: `${best.count} backdated entries added on ${formatDay(dayKey(new Date(best.start)))}`
        });
    }

    // at_limits: repeatedly entering values at the input limits
    const windowStart = now.getTime() - NEAR_LIMIT_WINDOW_DAYS * DAY_MS;
    const nearLimits = evaluated.filter(log => {
        const created = new Date(log.createdAt).getTime();
        return created > windowStart && created <= now.getTime() && isNearLimits(log.details);
    }).length;
    if (nearLimits >= NEAR_LIMIT_MIN_ENTRIES) {
        flags.push({
            code: 'at_limits',
            message: `${nearLimits} entries near the input limits in the last ${NEAR_LIMIT_WINDOW_DAYS} days`
        });
    }

    // over_cap: a month above the per-user monthly cap
    for (const [key, { total }] of evaluatedMonths) {
        if (total > MONTHLY_CAP_KG) {
            flags.push({
                code: 'over_cap',
                message: `${formatMonth(key)} totals ${formatKg(total)} kg (cap ${formatKg(MONTHLY_CAP_KG)})`
            });
        }
    }

    return flags;
}

function userStatus(user, logs, now) {
    if (user.is_demo) return 'demo';
    if (user.stats_status === 'trusted') return 'trusted';
    if (user.stats_status === 'excluded') return 'excluded';
    if (computeFlags(user, logs, now).length > 0) return 'flagged';
    return isEligible(user, logs, now) ? 'counted' : 'new';
}

// Public figures over the given users. capped: false skips only the monthly cap.
function computeMetrics(entries, { capped, now }) {
    const currentMonth = monthKey(now);
    const cap = (total) => (capped ? Math.min(total, MONTHLY_CAP_KG) : total);

    let totalKg = 0;
    const changes = [];
    let loggedDays = 0;
    let greenDays = 0;

    for (const { user, logs } of entries) {
        const months = groupByMonth(logs);

        for (const { total } of months.values()) totalKg += cap(total);

        // Footprint change: latest complete month vs the first two
        const complete = [...months.entries()]
            .filter(([key, m]) => key < currentMonth && m.days.size >= COMPLETE_MONTH_MIN_DAYS)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, m]) => cap(m.total));
        if (complete.length >= 3) {
            const baseline = (complete[0] + complete[1]) / 2;
            if (baseline > 0) changes.push((complete[complete.length - 1] - baseline) / baseline * 100);
        }

        // Green days: day total within this user's daily budget for that month
        const limit = user.monthly_limit > 0 ? user.monthly_limit : DEFAULT_MONTHLY_LIMIT;
        const dayTotals = new Map();
        for (const log of logs) {
            const key = dayKey(log.date);
            dayTotals.set(key, (dayTotals.get(key) || 0) + log.co2_impact);
        }
        for (const [key, total] of dayTotals) {
            loggedDays++;
            if (total <= limit / daysInMonth(key.slice(0, 7))) greenDays++;
        }
    }

    return {
        total_tonnes: round(totalKg / 1000, 2),
        change_pct: changes.length ? round(median(changes), 1) : null,
        green_days_pct: loggedDays ? round(greenDays / loggedDays * 100, 1) : null
    };
}

module.exports = {
    MIN_ACCOUNT_AGE_DAYS,
    MIN_ACTIVE_DAYS,
    MONTHLY_CAP_KG,
    COMPLETE_MONTH_MIN_DAYS,
    CACHE_TTL_MS,
    isEligible,
    computeFlags,
    userStatus,
    computeMetrics
};
