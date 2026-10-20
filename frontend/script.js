const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000'
    : 'https://carbonwise-c4di.onrender.com';

const CATEGORY_LABELS = {
    energy: 'Home energy',
    transport: 'Transportation',
    food: 'Food',
    shopping: 'Shopping'
};

// Emission factor catalogue, loaded from the API
let factors = null;

function logout(redirectTo = 'signin.html') {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = redirectTo;
}

// ---------- In-page messages ----------

// Small notification in the corner. type: success | error | info. duration 0 = stays until closed.
function showToast(message, type = 'success', duration = 4000) {
    let region = document.getElementById('toast-region');
    if (!region) {
        region = document.createElement('div');
        region.id = 'toast-region';
        region.className = 'toast-region';
        region.setAttribute('aria-live', 'polite');
        document.body.appendChild(region);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

    const text = document.createElement('span');
    text.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    toast.append(text, close);
    region.appendChild(toast);

    let timer;
    const dismiss = () => {
        clearTimeout(timer);
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 200);
    };
    close.addEventListener('click', dismiss);
    if (duration) timer = setTimeout(dismiss, duration);
    return { dismiss };
}

// Show a message on the next page (e.g. after a redirect)
function flash(message, type = 'success') {
    try {
        sessionStorage.setItem('flash', JSON.stringify({ message, type }));
    } catch (_) { /* storage unavailable: skip the message */ }
}

function showFlash() {
    try {
        const raw = sessionStorage.getItem('flash');
        if (!raw) return;
        sessionStorage.removeItem('flash');
        const { message, type } = JSON.parse(raw);
        showToast(message, type);
    } catch (_) { /* ignore */ }
}

// The free Render instance sleeps when idle, so the first request can be slow
function withWakeUpNotice(promise, delay = 4000) {
    let notice = null;
    const timer = setTimeout(() => {
        notice = showToast('Waking up the server... the first request can take up to a minute.', 'info', 0);
    }, delay);
    return promise.finally(() => {
        clearTimeout(timer);
        if (notice) notice.dismiss();
    });
}

// Put a button into a loading state; returns a function that restores it
function setBusy(button, label) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = label;
    return () => {
        button.disabled = false;
        button.textContent = original;
    };
}

// Unauthenticated POST used by sign-in, register and the demo
async function postJSON(path, body) {
    const response = await fetch(API_BASE_URL + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data };
}

function startSession(data) {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
}

// Authenticated JSON request. Sends the user to sign-in if the token is rejected.
async function apiFetch(path, { method = 'GET', body } = {}) {
    const response = await fetch(API_BASE_URL + path, {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
        logout();
    }
    return { ok: response.ok, status: response.status, data };
}

// ---------- Date helpers (all in the user's local time) ----------

function toDateInputValue(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function rangeQuery(from, to) {
    return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}

function dayRange(date = new Date()) {
    return rangeQuery(new Date(date.getFullYear(), date.getMonth(), date.getDate()), new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1));
}

function formatShortDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

document.addEventListener('DOMContentLoaded', () => {

    // Protect Dashboard route
    if (document.getElementById('tab-dashboard')) {
        if (!localStorage.getItem('token')) {
            window.location.href = 'signin.html';
            return;
        }
        initDashboard();
    }

    showFlash();

    if (document.getElementById('impact')) loadImpact();

    // Auth Forms
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('reg-name').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;

            if (password.length < 8) {
                showToast('Password must be at least 8 characters long.', 'error');
                return;
            }
            submitAuth(registerForm, '/api/auth/register', { name, email, password }, 'Creating account...',
                (user) => `Welcome to CarbonWise, ${user.name.split(' ')[0]}! Log your first activity under Consumption.`);
        });
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;

            if (password.length < 8) {
                showToast('Password must be at least 8 characters long.', 'error');
                return;
            }
            submitAuth(loginForm, '/api/auth/login', { email, password }, 'Signing in...',
                (user) => `Welcome back, ${user.name.split(' ')[0]}!`);
        });
    }

    // "Live demo": sign in to the shared read-only demo account
    document.querySelectorAll('[data-demo]').forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            const restore = setBusy(button, 'Starting demo...');
            try {
                const { ok, data } = await withWakeUpNotice(postJSON('/api/auth/demo'));
                if (!ok) throw new Error(data.message);
                startSession(data);
                flash('You\'re exploring a read-only demo with sample data.', 'info');
                window.location.href = 'dashboard.html';
            } catch (err) {
                console.error(err);
                showToast(err.message || 'Could not start the demo. Please try again.', 'error');
                restore();
            }
        });
    });

    // Dashboard Tab Switching
    const navLinks = document.querySelectorAll('.nav-link');
    const tabContents = document.querySelectorAll('.tab-content');

    if (navLinks.length > 0 && tabContents.length > 0) {
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                const targetId = link.getAttribute('data-target');
                if (!targetId) return;

                // Remove active from all links and tabs
                navLinks.forEach(l => l.classList.remove('active'));
                tabContents.forEach(t => t.classList.remove('active'));

                // Add active to clicked link
                link.classList.add('active');

                // Show target tab
                document.getElementById(targetId).classList.add('active');
            });
        });
    }
});

// ---------- Landing page: live impact figures ----------

function formatTonnes(tonnes) {
    // Round first: toFixed alone turns 2.55 (stored as 2.5499…) into 2.5
    const value = tonnes < 100 ? (Math.round(tonnes * 10) / 10).toFixed(1) : Math.round(tonnes).toLocaleString('en-US');
    return `${value} t CO₂e`;
}

function formatAgo(iso) {
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

// Decorative, so no wake-up notice; on any failure the section is hidden
async function loadImpact() {
    const section = document.getElementById('impact');
    try {
        const response = await fetch(API_BASE_URL + '/api/stats/public');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        setText('impact-total', formatTonnes(data.total_tonnes));

        if (data.change_pct === null) {
            setText('impact-change', '—');
        } else {
            const increase = data.change_pct > 0;
            setText('impact-change', `${increase ? '▲' : '▼'} ${Math.abs(Math.round(data.change_pct))}%`);
            setText('impact-change-label', `typical ${increase ? 'increase' : 'change'} in monthly footprint`);
        }

        setText('impact-green', data.green_days_pct === null ? '—' : `${Math.round(data.green_days_pct)}%`);
        setText('impact-updated', `Updated ${formatAgo(data.updated_at)}`);
    } catch (err) {
        console.error('Could not load impact figures', err);
        section.hidden = true;
    }
}

async function submitAuth(form, path, body, busyLabel, welcomeMessage) {
    const button = form.querySelector('button[type="submit"]');
    const restore = setBusy(button, busyLabel);
    try {
        const { ok, data } = await withWakeUpNotice(postJSON(path, body));
        if (ok) {
            startSession(data);
            flash(welcomeMessage(data.user));
            window.location.href = 'dashboard.html';
            return;
        }
        showToast(data.message || 'Something went wrong. Please try again.', 'error');
    } catch (error) {
        console.error('Error:', error);
        showToast('Could not reach the server. Please try again.', 'error');
    }
    restore();
}

function initDashboard() {
    // Setup logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logout('index.html');
        });
    }

    setupLogForms();
    setupHistory();
    setupSettings();

    setText('header-date', new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase());

    // Fetch user data
    withWakeUpNotice(apiFetch('/api/auth/me'))
        .then(({ ok, status, data }) => {
            if (ok && data.user) {
                showUser(data.user);
                if (data.user.is_demo) enterDemoMode();
                refreshDashboard();
            } else if (status === 404) {
                // Account no longer exists
                logout();
            } else if (status !== 401) {
                showToast(data.message || 'Could not load your account.', 'error');
            }
        })
        .catch(err => {
            console.error('Could not reach the server', err);
            showToast('Could not reach the server. Check your connection and refresh.', 'error', 0);
        });
}

function showUser(user) {
    setText('welcome-title', `welcome back, ${user.name.split(' ')[0]}!`);
    const nameInput = document.getElementById('input-profile-name');
    if (nameInput && document.activeElement !== nameInput) nameInput.value = user.name;
    setText('profile-email', user.email);
    const navAdmin = document.getElementById('nav-admin');
    if (navAdmin) navAdmin.hidden = !user.is_admin;
}

// The shared demo account is read-only: explain that and switch off editing
function enterDemoMode() {
    document.body.classList.add('demo-mode');

    const banner = document.getElementById('demo-banner');
    if (banner) banner.hidden = false;

    const readOnly = 'Not available in the read-only demo';
    document.querySelectorAll('.btn-log, #btn-save-settings, #btn-save-profile, #input-profile-name, #input-monthly-limit')
        .forEach(el => {
            el.disabled = true;
            el.title = readOnly;
        });

    setText('welcome-title', 'welcome to the demo!');
    setText('profile-email', 'Shared sample account');
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.textContent = 'Exit demo';
}

function refreshDashboard() {
    fetchMetrics();
    loadHistory();
    loadTodayCount();
}

// ---------- Logging forms ----------

function setupLogForms() {
    // Sub-tabs: Home energy / Transportation / Food / Shopping
    const formTabs = document.querySelectorAll('.activity-tabs span[data-form]');
    formTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            formTabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.log-form').forEach(f => f.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.form).classList.add('active');
        });
    });

    // Dates default to today and can't be in the future
    const today = toDateInputValue(new Date());
    document.querySelectorAll('.log-date').forEach(input => {
        input.value = today;
        input.max = today;
    });

    loadFactors();

    document.querySelectorAll('.log-form').forEach(form => {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            submitLog(form);
        });
    });
}

async function loadFactors() {
    try {
        const { ok, data } = await apiFetch('/api/logs/factors');
        if (!ok) return;
        factors = data.factors;

        // Build the option lists for transport modes, meals and shopping items
        document.querySelectorAll('select[data-factors]').forEach(select => {
            const table = factors[select.dataset.factors];
            select.innerHTML = '';
            Object.entries(table).forEach(([key, entry]) => {
                const option = document.createElement('option');
                option.value = key;
                option.textContent = entry.label;
                select.appendChild(option);
            });
        });

        // "People in the car" only applies to car modes
        const modeSelect = document.getElementById('transport-mode');
        const passengersRow = document.getElementById('row-passengers');
        const togglePassengers = () => {
            passengersRow.style.display = factors.transport[modeSelect.value]?.perVehicle ? '' : 'none';
        };
        modeSelect.addEventListener('change', togglePassengers);
        togglePassengers();
    } catch (err) {
        console.error('Failed to load emission factors', err);
    }
}

async function submitLog(form) {
    const body = { category: form.dataset.category };
    new FormData(form).forEach((value, key) => {
        if (key !== 'date' && value !== '') body[key] = value;
    });
    if (body.renewable !== undefined) body.renewable = body.renewable === 'true';

    // Today's entries use the current time; backdated ones use local midday
    const dateValue = form.querySelector('.log-date').value;
    if (dateValue && dateValue !== toDateInputValue(new Date())) {
        const [y, m, d] = dateValue.split('-').map(Number);
        body.date = new Date(y, m - 1, d, 12).toISOString();
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
        const { ok, data } = await apiFetch('/api/logs', { method: 'POST', body });
        if (ok) {
            showToast(`Logged ${data.log.co2_impact.toFixed(2)} kg CO₂e · ${data.log.description}`);
            // Clear the amounts but keep the selections and date
            form.querySelectorAll('input[type="number"]').forEach(input => {
                input.value = input.defaultValue;
            });
            refreshDashboard();
        } else {
            showToast(data.message || 'Could not add this entry.', 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Could not reach the server. Please try again.', 'error');
    } finally {
        button.disabled = false;
    }
}

// ---------- Activity history ----------

function setupHistory() {
    const filter = document.getElementById('history-filter');
    if (filter) filter.addEventListener('change', loadHistory);

    const list = document.getElementById('history-list');
    if (!list) return;

    // Two-step delete: first click asks for confirmation, second click deletes
    list.addEventListener('click', async (e) => {
        const button = e.target.closest('.history-delete');
        if (!button) return;

        if (!button.classList.contains('confirming')) {
            button.classList.add('confirming');
            button.textContent = 'Confirm';
            setTimeout(() => {
                button.classList.remove('confirming');
                button.textContent = 'Delete';
            }, 3000);
            return;
        }

        button.disabled = true;
        try {
            const { ok, data } = await apiFetch(`/api/logs/${button.dataset.id}`, { method: 'DELETE' });
            if (ok) {
                showToast('Entry deleted');
                refreshDashboard();
            } else {
                showToast(data.message || 'Could not delete this entry.', 'error');
                button.disabled = false;
            }
        } catch (err) {
            console.error(err);
            showToast('Could not reach the server. Please try again.', 'error');
            button.disabled = false;
        }
    });
}

async function loadHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;

    const category = document.getElementById('history-filter')?.value;
    const query = category ? `?category=${category}` : '';

    try {
        const { ok, data } = await apiFetch(`/api/logs${query}`);
        if (!ok) return;

        list.innerHTML = '';
        if (data.logs.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'history-empty';
            empty.textContent = category ? 'No entries in this category yet.' : 'No activity logged yet. Add your first entry above.';
            list.appendChild(empty);
            return;
        }

        data.logs.forEach(log => {
            const row = document.createElement('li');
            row.className = 'history-row';

            const cells = [
                ['history-date', formatShortDate(log.date)],
                ['history-tag', CATEGORY_LABELS[log.category] || log.category],
                ['history-desc', log.description],
                ['history-co2', `${log.co2_impact.toFixed(2)} kg`]
            ];
            cells.forEach(([className, text]) => {
                const cell = document.createElement('span');
                cell.className = className;
                cell.textContent = text;
                row.appendChild(cell);
            });

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'history-delete';
            del.dataset.id = log.id;
            del.textContent = 'Delete';
            del.setAttribute('aria-label', `Delete ${log.description}`);
            row.appendChild(del);

            list.appendChild(row);
        });
    } catch (err) {
        console.error('Error loading history', err);
    }
}

async function loadTodayCount() {
    try {
        const { ok, data } = await apiFetch(`/api/logs/metrics?${dayRange()}`);
        const el = document.getElementById('val-cons-today');
        if (ok && el) el.innerHTML = `${data.count}<span>${data.count === 1 ? 'entry' : 'entries'}</span>`;
    } catch (err) {
        console.error('Error loading today\'s entries', err);
    }
}

// ---------- Settings ----------

function setupSettings() {
    const btnSaveSettings = document.getElementById('btn-save-settings');
    if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', async (e) => {
            e.preventDefault();
            const newLimit = parseFloat(document.getElementById('input-monthly-limit').value);
            if (!Number.isFinite(newLimit) || newLimit <= 0) {
                showToast('Monthly limit must be a positive number.', 'error');
                return;
            }
            const restore = setBusy(btnSaveSettings, 'Saving...');
            try {
                const { ok, data } = await apiFetch('/api/auth/me', { method: 'PUT', body: { monthly_limit: newLimit } });
                if (ok) {
                    showToast(`Monthly limit set to ${newLimit} kg CO₂e`);
                    fetchMetrics();
                } else {
                    showToast(data.message || 'Could not save your limit.', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Could not reach the server. Please try again.', 'error');
            }
            restore();
        });
    }

    const btnSaveProfile = document.getElementById('btn-save-profile');
    if (btnSaveProfile) {
        btnSaveProfile.addEventListener('click', async (e) => {
            e.preventDefault();
            const name = document.getElementById('input-profile-name').value.trim();
            if (!name) {
                showToast('Name cannot be empty.', 'error');
                return;
            }
            const restore = setBusy(btnSaveProfile, 'Saving...');
            try {
                const { ok, data } = await apiFetch('/api/auth/me', { method: 'PUT', body: { name } });
                if (ok) {
                    showUser(data.user);
                    localStorage.setItem('user', JSON.stringify(data.user));
                    showToast('Profile updated');
                } else {
                    showToast(data.message || 'Could not update your profile.', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Could not reach the server. Please try again.', 'error');
            }
            restore();
        });
    }
}

// ---------- Dashboard metrics and charts (current month, local time) ----------

const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const KG = 'kgCO<sub>2</sub>e';

function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// Fill a progress bar, turning it red when over 100%
function setProgress(barId, pctTextId, pct, label) {
    const bar = document.getElementById(barId);
    if (bar) {
        bar.style.width = `${Math.min(100, Math.max(0, pct)).toFixed(0)}%`;
        bar.classList.toggle('over', pct > 100);
    }
    const text = document.getElementById(pctTextId);
    if (text) {
        text.textContent = `${pct.toFixed(0)}% of ${label}`;
        text.classList.toggle('over', pct > 100);
    }
}

async function fetchMetrics() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const tz = `tz=${encodeURIComponent(TIME_ZONE)}`;

    try {
        const [metrics, months, days] = await Promise.all([
            apiFetch(`/api/logs/metrics?${rangeQuery(monthStart, monthEnd)}`),
            apiFetch(`/api/logs/series?${rangeQuery(sixMonthsAgo, monthEnd)}&unit=month&${tz}`),
            apiFetch(`/api/logs/series?${rangeQuery(monthStart, monthEnd)}&unit=day&${tz}`)
        ]);
        if (!metrics.ok) return;

        const limitKg = parseFloat(metrics.data.monthly_limit || 400);
        renderTotals(metrics.data, limitKg, now);
        if (months.ok) renderTrends(months.data.series, now);
        if (days.ok) renderCalendar(days.data.series, limitKg, now);
    } catch (err) {
        console.error('Error fetching metrics', err);
    }
}

function renderTotals(data, limitKg, now) {
    const totalKg = parseFloat(data.total);

    setHTML('val-total-footprint', `${totalKg.toFixed(1)} <span>kg CO<sub>2</sub>e</span>`);
    ['transport', 'food', 'shopping', 'energy'].forEach(category => {
        setHTML(`val-${category}`, `${data.breakdown[category].toFixed(2)} ${KG}`);
    });

    // Month total against the monthly limit
    setHTML('val-dash-co2', `${totalKg.toFixed(1)} <span>kg CO<sub>2</sub></span>`);
    setText('val-dash-co2-target', `limit: ${limitKg.toFixed(0)} kg`);
    setProgress('bar-dash-co2', 'val-dash-co2-pct', (totalKg / limitKg) * 100, 'monthly limit');

    // Average per day so far against the limit spread evenly over the month
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dailyBudget = limitKg / daysInMonth;
    const dailyAverage = totalKg / now.getDate();
    setHTML('val-dash-daily', `${dailyAverage.toFixed(1)} <span>kg / day</span>`);
    setText('val-dash-daily-target', `budget: ${dailyBudget.toFixed(1)} kg / day`);
    setProgress('bar-dash-daily', 'val-dash-daily-pct', (dailyAverage / dailyBudget) * 100, 'daily budget');

    // Consumption tab stats
    setHTML('val-cons-month', `${totalKg.toFixed(1)}<span>kg CO<sub>2</sub>e</span>`);
    setHTML('val-cons-target', `${limitKg.toFixed(0)}<span>kg</span>`);

    // Settings input (unless the user is editing it)
    const inputMonthlyLimit = document.getElementById('input-monthly-limit');
    if (inputMonthlyLimit && document.activeElement !== inputMonthlyLimit) {
        inputMonthlyLimit.value = limitKg;
    }
}

// Six-month bars on each category card, plus last/this/average comparison
function renderTrends(series, now) {
    const byMonth = Object.fromEntries(series.map(s => [s.period, s]));
    const months = [];
    for (let i = 5; i >= 0; i--) {
        months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
    }

    document.querySelectorAll('.card[data-category]').forEach(card => {
        const category = card.dataset.category;
        const values = months.map(m => byMonth[monthKey(m)]?.breakdown[category] || 0);
        const max = Math.max(...values);
        const container = card.querySelector('.chart-bars');
        container.innerHTML = '';

        values.forEach((value, i) => {
            const bar = document.createElement('div');
            bar.className = i === values.length - 1 ? 'bar current' : 'bar';
            // Keep small non-zero months visible
            const pct = max > 0 ? Math.max(value / max * 100, value > 0 ? 8 : 0) : 0;
            bar.style.height = `${+pct.toFixed(1)}%`;
            bar.title = `${months[i].toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}: ${value.toFixed(2)} kg`;
            container.appendChild(bar);
        });
    });

    const totals = months.map(m => byMonth[monthKey(m)]?.total || 0);
    const thisMonth = totals[5];
    const lastMonth = totals[4];
    // Average of earlier months that have any entries
    const earlier = totals.slice(0, 5).filter(v => v > 0);
    const average = earlier.length ? earlier.reduce((a, b) => a + b, 0) / earlier.length : 0;

    const maxBar = Math.max(thisMonth, lastMonth, average);
    [['last', lastMonth], ['this', thisMonth], ['avg', average]].forEach(([key, value]) => {
        const bar = document.getElementById(`fb-bar-${key}`);
        if (bar) bar.style.height = `${maxBar > 0 ? Math.max(2, value / maxBar * 80) : 2}px`;
        setHTML(`fb-val-${key}`, `${value.toFixed(2)} ${KG}`);
    });

    if (lastMonth > 0) {
        const change = (thisMonth - lastMonth) / lastMonth * 100;
        setText('val-total-change', `${change > 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(0)}% vs last month so far`);
    } else {
        setText('val-total-change', 'no entries last month to compare');
    }
}

// One dot per day: tree = under the daily budget, dark = over, grey = nothing logged
function renderCalendar(series, limitKg, now) {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    const byDay = Object.fromEntries(series.map(s => [s.period, s]));
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dailyBudget = limitKg / daysInMonth;
    const monthName = now.toLocaleDateString(undefined, { month: 'long' });

    setText('cal-today', String(now.getDate()));
    setText('cal-month', `${monthName}, ${year}`);

    grid.innerHTML = '';
    // Monday-first week: blanks before the 1st
    const leading = (new Date(year, month, 1).getDay() + 6) % 7;
    for (let i = 0; i < leading; i++) {
        const blank = document.createElement('div');
        blank.className = 'cal-dot blank';
        grid.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dot = document.createElement('div');
        const entry = byDay[`${monthKey(now)}-${String(day).padStart(2, '0')}`];
        const classes = ['cal-dot'];
        let label;

        if (day > now.getDate()) {
            classes.push('empty');
            label = 'upcoming';
        } else if (entry && entry.count > 0) {
            classes.push(entry.total <= dailyBudget ? 'tree' : 'dark');
            label = `${entry.total.toFixed(2)} kg (budget ${dailyBudget.toFixed(1)} kg)`;
        } else {
            label = 'nothing logged';
        }
        if (day === now.getDate()) classes.push('today');

        dot.className = classes.join(' ');
        dot.title = `${day} ${monthName}: ${label}`;
        grid.appendChild(dot);
    }
}
