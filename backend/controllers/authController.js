// Dummy in-memory database for demonstration
const users = [];

exports.register = (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'All fields are required.' });
    }

    const userExists = users.find(u => u.email === email);
    if (userExists) {
        return res.status(400).json({ message: 'User already exists.' });
    }

    const newUser = { id: Date.now(), name, email, password }; // In a real app, hash the password!
    users.push(newUser);

    res.status(201).json({ message: 'User registered successfully!', user: { id: newUser.id, name, email } });
};

exports.login = (req, res) => {
    const { email, password } = req.body;

    const user = users.find(u => u.email === email);
    if (!user || user.password !== password) {
        return res.status(401).json({ message: 'Invalid credentials.' });
    }

    res.json({ message: 'Login successful!', user: { id: user.id, name: user.name, email: user.email } });
};

