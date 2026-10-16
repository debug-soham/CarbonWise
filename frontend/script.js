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

function monthRange(date = new Date()) {
    return rangeQuery(new Date(date.getFullYear(), date.getMonth(), 1), new Date(date.getFullYear(), date.getMonth() + 1, 1));
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

    // Auth Forms
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('reg-name').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;

            if (password.length < 8) {
                alert('Password must be at least 8 characters long.');
                return;
            }

            try {
                const response = await fetch(API_BASE_URL + '/api/auth/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password })
                });

                const data = await response.json();

                if (response.ok) {
                    // Save token
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('user', JSON.stringify(data.user));
                    alert('Registration successful!');
                    window.location.href = 'dashboard.html';
                } else {
                    alert(data.message || 'Registration failed.');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('An error occurred. Please try again.');
            }
        });
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;

            if (password.length < 8) {
                alert('Password must be at least 8 characters long.');
                return;
            }

            try {
                const response = await fetch(API_BASE_URL + '/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json();

                if (response.ok) {
                    // Save token
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('user', JSON.stringify(data.user));
                    alert(`Welcome back, ${data.user.name}!`);
                    window.location.href = 'dashboard.html';
                } else {
                    alert(data.message || 'Login failed.');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('An error occurred. Please try again.');
            }
        });
    }

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

    // Fetch user data
    apiFetch('/api/auth/me')
        .then(({ ok, status, data }) => {
            if (ok && data.user) {
                // Update username in the header
                const welcomeTitle = document.getElementById('welcome-title');
                if (welcomeTitle) {
                    welcomeTitle.textContent = `welcome back, ${data.user.name.split(' ')[0]}!`;
                }
                refreshDashboard();
            } else if (status === 404) {
                // Account no longer exists
                logout();
            } else if (status !== 401) {
                console.error('Failed to load user', data.message);
            }
        })
        .catch(err => console.error('Could not reach the server', err));
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
            alert(`Logged ${data.log.co2_impact.toFixed(2)} kg CO2e: ${data.log.description}`);
            // Clear the amounts but keep the selections and date
            form.querySelectorAll('input[type="number"]').forEach(input => {
                input.value = input.defaultValue;
            });
            refreshDashboard();
        } else {
            alert(data.message || 'Error adding log');
        }
    } catch (err) {
        console.error(err);
        alert('Could not reach the server. Please try again.');
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
                refreshDashboard();
            } else {
                alert(data.message || 'Could not delete this entry');
                button.disabled = false;
            }
        } catch (err) {
            console.error(err);
            alert('Could not reach the server. Please try again.');
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
    if (!btnSaveSettings) return;

    btnSaveSettings.addEventListener('click', async (e) => {
        e.preventDefault();
        const newLimit = parseFloat(document.getElementById('input-monthly-limit').value);
        if (!Number.isFinite(newLimit) || newLimit <= 0) {
            alert('Monthly limit must be a positive number.');
            return;
        }
        try {
            const { ok, data } = await apiFetch('/api/auth/me', { method: 'PUT', body: { monthly_limit: newLimit } });
            if (ok) {
                alert('Settings saved!');
                fetchMetrics();
            } else {
                alert(data.message || 'Error saving settings');
            }
        } catch (err) {
            console.error(err);
            alert('Error saving settings');
        }
    });
}

// ---------- Metrics (current month) ----------

async function fetchMetrics() {
    try {
        const { ok, data } = await apiFetch(`/api/logs/metrics?${monthRange()}`);

        if (ok) {
            document.getElementById('val-total-footprint').innerHTML = `${parseFloat(data.total).toFixed(1)} <span>kg CO<sub>2</sub>e</span>`;
            document.getElementById('val-transport').innerHTML = `${data.breakdown.transport.toFixed(2)} kgCO<sub>2</sub>e`;
            document.getElementById('val-food').innerHTML = `${data.breakdown.food.toFixed(2)} kgCO<sub>2</sub>e`;
            document.getElementById('val-shopping').innerHTML = `${data.breakdown.shopping.toFixed(2)} kgCO<sub>2</sub>e`;
            document.getElementById('val-energy').innerHTML = `${data.breakdown.energy.toFixed(2)} kgCO<sub>2</sub>e`;

            // Calculate and display percentages
            const totalKg = parseFloat(data.total);
            const limitKg = parseFloat(data.monthly_limit || 400.0);

            // Update Dashboard Co2 Bar
            const pct = Math.min(100, Math.max(0, (totalKg / limitKg) * 100)).toFixed(0);
            const valDashCo2 = document.getElementById('val-dash-co2');
            if(valDashCo2) valDashCo2.innerHTML = `${totalKg.toFixed(1)} <span>kg CO<sub>2</sub></span>`;

            const valDashCo2Pct = document.getElementById('val-dash-co2-pct');
            if(valDashCo2Pct) valDashCo2Pct.textContent = `${pct}% of sustainable limit`;

            const valDashCo2Target = document.getElementById('val-dash-co2-target');
            if(valDashCo2Target) valDashCo2Target.textContent = `target: ${limitKg.toFixed(0)} kgCO2`;

            const barDashCo2 = document.getElementById('bar-dash-co2');
            if(barDashCo2) barDashCo2.style.width = `${pct}%`;

            // Update Dashboard Gha Bar (mock conversion: 1000 kg ~ 0.5 gha)
            const totalGha = (totalKg / 2000.0).toFixed(1);
            const limitGha = (limitKg / 2000.0).toFixed(1);

            const valDashGha = document.getElementById('val-dash-gha');
            if(valDashGha) valDashGha.innerHTML = `${totalGha} <span>gha</span>`;

            const valDashGhaPct = document.getElementById('val-dash-gha-pct');
            if(valDashGhaPct) valDashGhaPct.textContent = `${pct}% of sustainable limit`;

            const valDashGhaTarget = document.getElementById('val-dash-gha-target');
            if(valDashGhaTarget) valDashGhaTarget.textContent = `target: ${limitGha} gha`;

            const barDashGha = document.getElementById('bar-dash-gha');
            if(barDashGha) barDashGha.style.width = `${pct}%`;

            // Update Consumption Tab stats
            const valConsMonth = document.getElementById('val-cons-month');
            if(valConsMonth) valConsMonth.innerHTML = `${totalKg.toFixed(1)}<span>kg CO<sub>2</sub>e</span>`;

            const valConsTarget = document.getElementById('val-cons-target');
            if(valConsTarget) valConsTarget.innerHTML = `${limitKg.toFixed(0)}<span>kg</span>`;

            // Update Settings input field
            const inputMonthlyLimit = document.getElementById('input-monthly-limit');
            if(inputMonthlyLimit && document.activeElement !== inputMonthlyLimit) {
                inputMonthlyLimit.value = limitKg;
            }
        }
    } catch (err) {
        console.error('Error fetching metrics', err);
    }
}
