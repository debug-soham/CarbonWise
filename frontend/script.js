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

        // Fetch user data
        fetch('http://localhost:5000/api/auth/me', {
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
                const response = await fetch('http://localhost:5000/api/auth/register', {
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
                const response = await fetch('http://localhost:5000/api/auth/login', {
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
