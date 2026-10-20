// Admin page: review the accounts behind the public impact figures.
// Relies on helpers from script.js (apiFetch, showToast, flash, setText).

const ACTIONS = {
    exclude: { label: 'Exclude', status: 'excluded', done: 'is now excluded from public figures' },
    trust: { label: 'Trust', status: 'trusted', done: 'is now trusted' },
    auto: { label: 'Reset to auto', status: 'auto', done: 'is back on automatic rules' },
    dismiss: { label: 'Dismiss', done: 'flags dismissed' }
};

const usersState = { search: '', status: '', page: 1 };

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('tab-overview')) initAdmin();
});

async function initAdmin() {
    if (!localStorage.getItem('token')) {
        window.location.href = 'signin.html';
        return;
    }
    if (!(await loadOverview())) return;
    loadFlags();
    loadUsers();
    setupUserControls();

    // Flag and user actions share one handler
    document.querySelector('.app-main').addEventListener('click', (e) => {
        const button = e.target.closest('button[data-action]');
        if (button) runAction(button);
    });
}

// GET an admin route; sends non-admins back to the dashboard
async function adminGet(path) {
    const { ok, status, data } = await withWakeUpNotice(apiFetch(path));
    if (status === 403) {
        flash("You don't have admin access.", 'error');
        window.location.href = 'dashboard.html';
        return null;
    }
    if (!ok) {
        if (status !== 401) showToast(data.message || 'Could not load admin data.', 'error');
        return null;
    }
    return data;
}

// ---------- Overview ----------

const formatTotal = (t) => `${t.toFixed(2)} t`;
const formatChange = (c) => (c === null ? '—' : `${c > 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(1)}%`);
const formatPct = (p) => (p === null ? '—' : `${p.toFixed(1)}%`);

async function loadOverview() {
    const data = await adminGet('/api/admin/overview');
    if (!data) return false;

    for (const [scope, metrics] of [['public', data.public], ['raw', data.raw]]) {
        setText(`ov-${scope}-total`, formatTotal(metrics.total_tonnes));
        setText(`ov-${scope}-change`, formatChange(metrics.change_pct));
        setText(`ov-${scope}-green`, formatPct(metrics.green_days_pct));
    }
    Object.entries(data.counts).forEach(([key, value]) => setText(`count-${key}`, String(value)));
    return true;
}

// ---------- Flags ----------

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function actionButton(action, user) {
    const button = el('button', 'btn btn-secondary admin-action', ACTIONS[action].label);
    button.type = 'button';
    button.dataset.action = action;
    button.dataset.userId = user.id;
    button.dataset.userName = user.name;
    return button;
}

const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

async function loadFlags() {
    const flagged = await adminGet('/api/admin/flags');
    if (!flagged) return;

    const list = document.getElementById('flags-list');
    list.replaceChildren();
    if (flagged.length === 0) {
        list.appendChild(el('p', 'admin-empty', 'No flagged accounts.'));
        return;
    }

    for (const { user, flags } of flagged) {
        const card = el('div', 'flag-card');
        card.dataset.userId = user.id;

        const head = el('div', 'flag-card-head');
        head.append(el('strong', '', user.name), el('span', 'flag-card-meta', `${user.email} · joined ${formatDate(user.created_at)} · ${user.entries} entries`));

        const reasons = el('ul', 'flag-reasons');
        flags.forEach(flag => reasons.appendChild(el('li', '', flag.message)));

        const actions = el('div', 'flag-actions');
        actions.append(actionButton('dismiss', user), actionButton('exclude', user), actionButton('trust', user));

        card.append(head, reasons, actions);
        list.appendChild(card);
    }
}

// ---------- Users ----------

function setupUserControls() {
    let timer;
    document.getElementById('user-search').addEventListener('input', (e) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            usersState.search = e.target.value.trim();
            usersState.page = 1;
            loadUsers();
        }, 300);
    });
    document.getElementById('user-status').addEventListener('change', (e) => {
        usersState.status = e.target.value;
        usersState.page = 1;
        loadUsers();
    });
    document.getElementById('users-prev').addEventListener('click', () => { usersState.page--; loadUsers(); });
    document.getElementById('users-next').addEventListener('click', () => { usersState.page++; loadUsers(); });
}

async function loadUsers() {
    const query = new URLSearchParams({ page: usersState.page });
    if (usersState.search) query.set('search', usersState.search);
    if (usersState.status) query.set('status', usersState.status);

    const data = await adminGet(`/api/admin/users?${query}`);
    if (!data) return;
    usersState.page = data.page;

    const body = document.querySelector('#users-table tbody');
    body.replaceChildren();
    if (data.users.length === 0) {
        const row = el('tr');
        const cell = el('td', 'admin-empty', 'No matching users.');
        cell.colSpan = 7;
        row.appendChild(cell);
        body.appendChild(row);
    }

    for (const user of data.users) {
        const row = el('tr');
        row.dataset.userId = user.id;
        // data-label names each value when rows stack into cards on phones
        const cell = (className, text, label) => {
            const td = el('td', className, text);
            if (label) td.dataset.label = label;
            return td;
        };
        row.append(
            cell('user-name', user.name),
            cell('user-email', user.email),
            cell('', formatDate(user.created_at), 'Joined'),
            cell('', String(user.entries), 'Entries'),
            cell('', formatDate(user.last_active), 'Last active')
        );
        const statusCell = el('td');
        statusCell.appendChild(el('span', `user-status status-${user.status}`, user.status));
        row.appendChild(statusCell);

        // The demo account is managed automatically, so it has no actions
        const actions = el('td', 'user-actions');
        if (!user.is_demo) {
            if (user.status !== 'excluded') actions.appendChild(actionButton('exclude', user));
            if (user.status !== 'trusted') actions.appendChild(actionButton('trust', user));
            if (user.status === 'excluded' || user.status === 'trusted') actions.appendChild(actionButton('auto', user));
        }
        row.appendChild(actions);
        body.appendChild(row);
    }

    setText('users-page', `Page ${data.page} of ${data.pages} · ${data.total} ${data.total === 1 ? 'user' : 'users'}`);
    document.getElementById('users-prev').disabled = data.page <= 1;
    document.getElementById('users-next').disabled = data.page >= data.pages;
}

// ---------- Actions ----------

async function runAction(button) {
    const { action, userId, userName } = button.dataset;
    const config = ACTIONS[action];
    const restore = setBusy(button, 'Saving...');
    try {
        const { ok, data } = action === 'dismiss'
            ? await apiFetch(`/api/admin/users/${userId}/dismiss-flags`, { method: 'POST' })
            : await apiFetch(`/api/admin/users/${userId}`, { method: 'PATCH', body: { stats_status: config.status } });

        if (ok) {
            showToast(action === 'dismiss' ? `${userName}: ${config.done}` : `${userName} ${config.done}`);
            await Promise.all([loadOverview(), loadFlags(), loadUsers()]);
            return;
        }
        showToast(data.message || 'Could not update the account.', 'error');
    } catch (err) {
        console.error(err);
        showToast('Could not reach the server. Please try again.', 'error');
    }
    restore();
}
