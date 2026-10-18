// Calendar days and months for app-wide rules (daily entry limit, public
// statistics) are counted in one fixed time zone so every user lines up.
const APP_TIME_ZONE = 'Asia/Kolkata';

const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

const wallClock = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
});

// 'YYYY-MM-DD' in the app time zone
function dayKey(date) {
    return dateParts.format(date);
}

// 'YYYY-MM' in the app time zone
function monthKey(date) {
    return dayKey(date).slice(0, 7);
}

// Milliseconds the app time zone is ahead of UTC at this instant
function zoneOffsetMs(date) {
    const p = Object.fromEntries(wallClock.formatToParts(date).map(({ type, value }) => [type, value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// UTC instants bounding the app-time-zone calendar day that contains `date`
function dayBoundsUtc(date) {
    const [y, m, d] = dayKey(date).split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, d) - zoneOffsetMs(date));
    return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

module.exports = { APP_TIME_ZONE, dayKey, monthKey, dayBoundsUtc };
