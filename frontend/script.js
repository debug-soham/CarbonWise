/*
   CarbonWise - Interactive Logic
*/

document.addEventListener('DOMContentLoaded', () => {
    console.log("CarbonWise App Initialized");

    const API_URL = 'http://localhost:5000/api';

    // Handle Registration Form
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('reg-name').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;

            try {
                const response = await fetch(`${API_URL}/auth/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password })
                });

                const data = await response.json();

                if (response.ok) {
                    alert('Registration successful! Please sign in.');
                    window.location.href = 'signin.html';
                } else {
                    alert(data.message || 'Registration failed.');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('An error occurred. Make sure the backend server is running.');
            }
        });
    }

    // Handle Login Form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('login-email').value;
            const password = document.getElementById('login-password').value;

            try {
                const response = await fetch(`${API_URL}/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json();

                if (response.ok) {
                    alert(`Welcome back, ${data.user.name}!`);
                    window.location.href = 'dashboard.html';
                } else {
                    alert(data.message || 'Login failed.');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('An error occurred. Make sure the backend server is running.');
            }
        });
    }
});

    // Dashboard Tab Switching
    const navLinks = document.querySelectorAll('.nav-link');
    const tabContents = document.querySelectorAll('.tab-content');

    if (navLinks.length > 0 && tabContents.length > 0) {
        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                // Remove active from all links and tabs
                navLinks.forEach(l => l.classList.remove('active'));
                tabContents.forEach(t => t.classList.remove('active'));

                // Add active to clicked link
                link.classList.add('active');

                // Show target tab
                const targetId = link.getAttribute('data-target');
                document.getElementById(targetId).classList.add('active');
            });
        });
    }
