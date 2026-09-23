const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000'
    : 'https://carbonwise-backend.onrender.com'; // Replace with actual Render URL once deployed

document.addEventListener('DOMContentLoaded', () => {

    // Protect Dashboard route
    const currentPath = window.location.pathname;
    if (currentPath.includes('dashboard.html')) {
        const token = localStorage.getItem('token');
        if (!token) {
            window.location.href = 'signin.html';
            return;
        }

        // Setup logout button
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                window.location.href = 'index.html';
            });
        }

        const btnAddLog = document.getElementById('btn-add-log');
        if (btnAddLog) {
            btnAddLog.addEventListener('click', async (e) => {
                e.preventDefault();
                const electricity = document.getElementById('energy-electricity').value;
                const gas = document.getElementById('energy-gas').value;
                const renewablesSelect = document.getElementById('energy-renewables');
                const useRenewables = renewablesSelect ? renewablesSelect.value.toLowerCase() === 'yes' : false;
                
                try {
                    const response = await fetch(API_BASE_URL + '/api/logs', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ category: 'energy', electricity, gas, useRenewables })
                    });
                    
                    const data = await response.json();
                    if (response.ok) {
                        alert('Footprint calculated and logged successfully!');
                        document.getElementById('energy-electricity').value = '';
                        document.getElementById('energy-gas').value = '';
                        fetchMetrics(token);
                        const navLink = document.querySelector('.nav-link[data-target="tab-dashboard"]');
                        if(navLink) navLink.click();
                    } else {
                        alert(data.message || 'Error adding log');
                    }
                } catch (err) {
                    console.error(err);
                    alert('An error occurred');
                }
            });
        }

        const btnSaveSettings = document.getElementById('btn-save-settings');
        if (btnSaveSettings) {
            btnSaveSettings.addEventListener('click', async (e) => {
                e.preventDefault();
                const newLimit = document.getElementById('input-monthly-limit').value;
                const token = localStorage.getItem('token');
                try {
                    const response = await fetch(API_BASE_URL + '/api/auth/me', {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ monthly_limit: parseFloat(newLimit) })
                    });
                    if (response.ok) {
                        alert('Settings saved!');
                        fetchMetrics(token);
                    } else {
                        const data = await response.json();
                        alert(data.message || 'Error saving settings');
                    }
                } catch(err) {
                    console.error(err);
                    alert('Error saving settings');
                }
            });
        }


        



        // Fetch user data
        fetch(API_BASE_URL + '/api/auth/me', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(res => res.json())
        .then(data => {
            if (data.user) {
                // Update username in the header
                const welcomeTitle = document.querySelector('.header-text h2');
                if (welcomeTitle) {
                    welcomeTitle.textContent = `welcome back, ${data.user.name.split(' ')[0]}!`;
                }
                fetchMetrics(token);
            } else {
                // Invalid token
                localStorage.removeItem('token');
                window.location.href = 'signin.html';
            }
        })
        .catch(err => console.error(err));
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
            link.addEventListener('click', (e) => {
                // Note: we let href navigate if it's the logout button, but it's handled above
                // Ensure we don't mess up non-tab links
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


async function fetchMetrics(token) {
    try {
        const response = await fetch(API_BASE_URL + '/api/logs/metrics', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (response.ok) {
            document.getElementById('val-total-footprint').textContent = data.total;
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
            
            // Update Consumption Tab Target text
            const valConsTarget = document.getElementById('val-cons-target');
            if(valConsTarget) valConsTarget.innerHTML = `${limitKg.toFixed(0)}<span>kg</span>`;
            
            // Update Settings input field
            const inputMonthlyLimit = document.getElementById('input-monthly-limit');
            if(inputMonthlyLimit && inputMonthlyLimit.value === '400') {
                inputMonthlyLimit.value = limitKg;
            }
        }
    } catch (err) {
        console.error('Error fetching metrics', err);
    }
}

        
