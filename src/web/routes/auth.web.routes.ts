import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { User } from '../../db/models/index.js';

export const authWebRoutes = Router();

// Landing page
authWebRoutes.get('/', (req: Request, res: Response) => {
  if (req.session?.userId) {
    res.redirect('/dashboard');
    return;
  }
  res.render('landing', { title: 'Welcome' });
});

// Login page
authWebRoutes.get('/login', (req: Request, res: Response) => {
  if (req.session?.userId) {
    res.redirect('/dashboard');
    return;
  }
  res.render('login', { title: 'Login', flash: {} });
});

// Login handler
authWebRoutes.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.render('login', { title: 'Login', flash: { error: 'Username and password are required.' } });
      return;
    }

    const user = await User.findOne({ username });
    if (!user) {
      res.render('login', { title: 'Login', flash: { error: 'Invalid username or password.' } });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.render('login', { title: 'Login', flash: { error: 'Invalid username or password.' } });
      return;
    }

    // Update last login
    user.lastLoginAt = new Date();
    await user.save();

    // Create session
    req.session.userId = user._id.toString();
    req.session.username = user.username;
    req.session.role = user.role;

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Login error:', err);
    res.render('login', { title: 'Login', flash: { error: 'An unexpected error occurred.' } });
  }
});

// Register page
authWebRoutes.get('/register', (req: Request, res: Response) => {
  if (req.session?.userId) {
    res.redirect('/dashboard');
    return;
  }
  res.render('register', { title: 'Register', flash: {} });
});

// Register handler
authWebRoutes.post('/auth/register', async (req: Request, res: Response) => {
  try {
    const { username, email, password, confirmPassword } = req.body;

    if (!username || !email || !password || !confirmPassword) {
      res.render('register', { title: 'Register', flash: { error: 'All fields are required.' } });
      return;
    }

    if (password !== confirmPassword) {
      res.render('register', { title: 'Register', flash: { error: 'Passwords do not match.' } });
      return;
    }

    if (password.length < 6) {
      res.render('register', { title: 'Register', flash: { error: 'Password must be at least 6 characters.' } });
      return;
    }

    // Check for existing user
    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) {
      const field = existing.username === username ? 'Username' : 'Email';
      res.render('register', { title: 'Register', flash: { error: `${field} is already taken.` } });
      return;
    }

    // First user becomes operator, rest are spectators
    const userCount = await User.countDocuments();
    const role = userCount === 0 ? 'operator' : 'spectator';

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      username,
      email,
      passwordHash,
      role,
    });

    // Create session
    req.session.userId = user._id.toString();
    req.session.username = user.username;
    req.session.role = user.role;

    res.redirect('/dashboard');
  } catch (err) {
    console.error('Register error:', err);
    res.render('register', { title: 'Register', flash: { error: 'An unexpected error occurred.' } });
  }
});

// Logout handler
authWebRoutes.post('/auth/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {});
  res.redirect('/login');
});
