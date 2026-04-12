# Mission Control Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-file admin dashboard with a multi-user server-rendered web app supporting three roles (Operator, Agent Owner, Spectator), user authentication, replicant management, and a human gameplay interface.

**Architecture:** Express + EJS server-rendered pages with vanilla JS interactive islands. Sessions in MongoDB via connect-mongo. New User model separate from Replicant. Existing REST API unchanged — new frontend is another consumer.

**Tech Stack:** Express 5, EJS, express-session, connect-mongo, bcrypt, vanilla JS (ES modules for islands)

---

## File Structure

```
src/
  db/models/User.ts              # NEW — User model
  db/models/index.ts             # MODIFY — export User
  web/
    middleware/
      session.ts                 # NEW — session config
      roles.ts                   # NEW — requireAuth, requireRole
    routes/
      auth.web.routes.ts         # NEW — login, register, logout (web)
      pages.routes.ts            # NEW — spectator + owner pages
      admin.pages.routes.ts      # NEW — operator pages
    views/
      layout.ejs                 # NEW — shared shell (nav, header)
      partials/
        nav.ejs                  # NEW — sidebar
        header.ejs               # NEW — top bar
        flash.ejs                # NEW — success/error messages
      landing.ejs                # NEW
      login.ejs                  # NEW
      register.ejs               # NEW
      dashboard.ejs              # NEW — overview
      map.ejs                    # NEW — sol map
      feed.ejs                   # NEW — event timeline
      replicants.ejs             # NEW — my replicants
      replicant.ejs              # NEW — detail
      comms.ejs                  # NEW — chat with replicant
      play.ejs                   # NEW — human player
      keys.ejs                   # NEW — API key management
      admin/
        index.ejs                # NEW — operator dashboard
        settlements.ejs          # NEW
        events.ejs               # NEW
        game.ejs                 # NEW
        users.ejs                # NEW
    public/
      css/style.css              # NEW — industrial aerospace theme
      js/
        map.js                   # NEW — sol map canvas
        play.js                  # NEW — human player island
        replicant-detail.js      # NEW — live replicant data
        feed.js                  # NEW — event timeline
  api/server.ts                  # MODIFY — mount web routes, EJS, session
  config.ts                      # MODIFY — add session secret
  index.ts                       # MODIFY — import web setup
```

---

### Task 1: Install Dependencies & Configure EJS + Sessions

**Files:**
- Modify: `package.json`
- Modify: `src/config.ts`
- Modify: `src/api/server.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Install dependencies**

```bash
npm install express-session connect-mongo bcrypt ejs
npm install -D @types/express-session @types/bcrypt
```

- [ ] **Step 2: Add session config to `src/config.ts`**

Add to the config object:

```typescript
session: {
  secret: process.env.SESSION_SECRET || 'homosideria-session-secret-change-me',
  maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
},
```

- [ ] **Step 3: Set up EJS and session middleware in `src/api/server.ts`**

At the top of `createApp()`, after `app.use(express.json())`:

```typescript
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { config } from '../config.js';

// EJS setup
app.set('view engine', 'ejs');
app.set('views', join(__dirname, '..', 'web', 'views'));

// Session middleware
app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  name: 'homosideria.sid',
  cookie: {
    maxAge: config.session.maxAgeMs,
    httpOnly: true,
    sameSite: 'lax',
  },
  store: MongoStore.create({
    mongoUrl: config.mongodb.uri,
    collectionName: 'sessions',
  }),
}));

// Static files for web UI
app.use('/static', express.static(join(__dirname, '..', 'web', 'public')));
```

- [ ] **Step 4: Verify compilation**

```bash
npx tsc --noEmit
```

Expected: 0 errors (EJS files aren't compiled by TS)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: install EJS, express-session, connect-mongo, bcrypt"
```

---

### Task 2: User Model

**Files:**
- Create: `src/db/models/User.ts`
- Modify: `src/db/models/index.ts`

- [ ] **Step 1: Create User model**

Create `src/db/models/User.ts`:

```typescript
import { Schema, model, type Document, type Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  username: string;
  email: string;
  passwordHash: string;
  role: 'operator' | 'owner' | 'spectator';
  replicantIds: Types.ObjectId[];
  apiKeys: Array<{
    key: string;
    name: string;
    replicantId: Types.ObjectId;
    createdAt: Date;
    lastUsedAt: Date | null;
    active: boolean;
  }>;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: {
    type: String,
    enum: ['operator', 'owner', 'spectator'],
    default: 'spectator',
  },
  replicantIds: [{ type: Schema.Types.ObjectId, ref: 'Replicant' }],
  apiKeys: [{
    key: { type: String, required: true },
    name: { type: String, required: true },
    replicantId: { type: Schema.Types.ObjectId, ref: 'Replicant' },
    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
  }],
  lastLoginAt: { type: Date, default: null },
}, { timestamps: true });

export const User = model<IUser>('User', UserSchema);
```

- [ ] **Step 2: Export from model index**

Add to `src/db/models/index.ts`:

```typescript
export { User, type IUser } from './User.js';
```

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/db/models/User.ts src/db/models/index.ts
git commit -m "feat: add User model with roles and API key management"
```

---

### Task 3: Session Middleware & Role Guards

**Files:**
- Create: `src/web/middleware/session.ts`
- Create: `src/web/middleware/roles.ts`

- [ ] **Step 1: Create session type extension**

Create `src/web/middleware/session.ts`:

```typescript
import type { IUser } from '../../db/models/User.js';

declare module 'express-session' {
  interface SessionData {
    userId: string;
    username: string;
    role: string;
  }
}

export type { IUser };
```

- [ ] **Step 2: Create role middleware**

Create `src/web/middleware/roles.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { User } from '../../db/models/index.js';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session?.userId) {
    res.redirect('/login');
    return;
  }
  const user = await User.findById(req.session.userId).lean();
  if (!user) {
    req.session.destroy(() => {});
    res.redirect('/login');
    return;
  }
  res.locals.user = user;
  res.locals.isOperator = user.role === 'operator';
  res.locals.isOwner = user.role === 'owner' || user.role === 'operator';
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = res.locals.user;
    if (!user || !roles.includes(user.role)) {
      res.status(403).render('layout', {
        title: 'Forbidden',
        body: '<h2>Access Denied</h2><p>You do not have permission to view this page.</p>',
        currentPath: req.path,
      });
      return;
    }
    next();
  };
}
```

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/web/
git commit -m "feat: add session type extension and role guard middleware"
```

---

### Task 4: CSS Theme — Industrial Aerospace

**Files:**
- Create: `src/web/public/css/style.css`

- [ ] **Step 1: Create the theme CSS**

Create `src/web/public/css/style.css` with the full industrial aerospace theme:

```css
:root {
  --bg: #0c0c0c;
  --surface: #171717;
  --surface-alt: #1a1a1a;
  --border: #2a2a2a;
  --border-light: #333;
  --text: #fafafa;
  --text-dim: #a3a3a3;
  --text-muted: #737373;
  --accent: #f59e0b;
  --accent-dim: rgba(245,158,11,0.13);
  --green: #22c55e;
  --red: #ef4444;
  --blue: #3b82f6;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

/* Layout shell */
.app { display: flex; min-height: 100vh; }
.sidebar {
  width: 220px; background: var(--surface); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; position: fixed; top: 0; bottom: 0; left: 0; z-index: 10;
}
.topbar {
  height: 52px; background: var(--surface); border-bottom: 1px solid var(--border);
  display: flex; align-items: center; padding: 0 24px; position: fixed; top: 0; left: 220px; right: 0; z-index: 9;
}
.main { margin-left: 220px; margin-top: 52px; padding: 24px; flex: 1; min-height: calc(100vh - 52px); }

/* Sidebar nav */
.sidebar-brand {
  padding: 16px 20px; border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 8px;
}
.sidebar-brand .dot { width: 8px; height: 8px; background: var(--accent); border-radius: 50%; }
.sidebar-brand span { color: var(--accent); font-size: 13px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; }
.sidebar-section { padding: 12px 0; }
.sidebar-label { padding: 4px 20px; font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1.5px; }
.sidebar-link {
  display: block; padding: 8px 20px; color: var(--text-dim); text-decoration: none; font-size: 13px;
  border-left: 3px solid transparent; transition: all 0.15s;
}
.sidebar-link:hover { color: var(--text); background: rgba(255,255,255,0.03); }
.sidebar-link.active { color: var(--accent); border-left-color: var(--accent); background: var(--accent-dim); }

/* Topbar */
.topbar-left { display: flex; align-items: center; gap: 16px; }
.topbar-center { flex: 1; text-align: center; }
.topbar-right { display: flex; align-items: center; gap: 12px; }
.game-time { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--accent); }
.user-menu { font-size: 13px; color: var(--text-dim); }
.role-badge {
  display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px;
  text-transform: uppercase; letter-spacing: 1px; font-weight: 700;
}
.role-badge.operator { background: var(--accent-dim); color: var(--accent); border: 1px solid var(--accent); }
.role-badge.owner { background: rgba(59,130,246,0.13); color: var(--blue); border: 1px solid var(--blue); }
.role-badge.spectator { background: rgba(163,163,163,0.1); color: var(--text-muted); border: 1px solid var(--border-light); }

/* Cards */
.card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 4px;
  padding: 16px; margin-bottom: 12px;
}
.card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.card-title { font-size: 14px; font-weight: 600; }

/* Stat boxes */
.stat-box {
  background: var(--surface); border-left: 3px solid var(--accent); padding: 12px 16px;
}
.stat-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; }
.stat-value { font-size: 22px; font-weight: 700; font-family: system-ui; margin-top: 2px; }

/* Buttons */
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border: 1px solid var(--border-light); border-radius: 4px;
  background: var(--surface-alt); color: var(--text); font-size: 13px; cursor: pointer;
  font-family: inherit; transition: all 0.15s;
}
.btn:hover { background: var(--border); }
.btn-accent { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }
.btn-accent:hover { background: var(--accent); color: #000; }
.btn-danger { background: rgba(239,68,68,0.1); border-color: var(--red); color: var(--red); }
.btn-danger:hover { background: var(--red); color: #fff; }

/* Forms */
.form-group { margin-bottom: 16px; }
.form-label { display: block; font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
.form-input {
  width: 100%; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border);
  border-radius: 4px; color: var(--text); font-size: 14px; font-family: inherit;
}
.form-input:focus { outline: none; border-color: var(--accent); }

/* Tables */
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 8px 12px; font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid var(--border); }
td { padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 13px; }
tr:hover { background: rgba(255,255,255,0.02); }

/* Progress bars */
.progress { height: 8px; background: var(--border); border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
.progress-fill.accent { background: var(--accent); }
.progress-fill.green { background: var(--green); }
.progress-fill.red { background: var(--red); }
.progress-fill.blue { background: var(--blue); }

/* Status indicators */
.status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
.status-dot.active { background: var(--green); }
.status-dot.idle { background: var(--text-muted); }
.status-dot.danger { background: var(--red); }
.status-dot.warning { background: var(--accent); }

/* Flash messages */
.flash { padding: 12px 16px; border-radius: 4px; margin-bottom: 16px; font-size: 13px; }
.flash-success { background: rgba(34,197,94,0.1); border-left: 3px solid var(--green); color: var(--green); }
.flash-error { background: rgba(239,68,68,0.1); border-left: 3px solid var(--red); color: var(--red); }

/* Utility */
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
.grid-4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 16px; }
.mono { font-family: 'JetBrains Mono', monospace; }
.text-accent { color: var(--accent); }
.text-dim { color: var(--text-dim); }
.text-muted { color: var(--text-muted); }
.mt-4 { margin-top: 16px; }
.mb-4 { margin-bottom: 16px; }
.mb-6 { margin-bottom: 24px; }
```

- [ ] **Step 2: Commit**

```bash
git add src/web/public/css/style.css
git commit -m "feat: add industrial aerospace CSS theme"
```

---

### Task 5: Layout Template & Partials

**Files:**
- Create: `src/web/views/layout.ejs`
- Create: `src/web/views/partials/nav.ejs`
- Create: `src/web/views/partials/header.ejs`
- Create: `src/web/views/partials/flash.ejs`

- [ ] **Step 1: Create layout.ejs**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><%= typeof title !== 'undefined' ? title + ' — ' : '' %>Homosideria</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/css/style.css">
</head>
<body>
<% if (typeof user !== 'undefined' && user) { %>
  <div class="app">
    <%- include('partials/nav', { user, currentPath: typeof currentPath !== 'undefined' ? currentPath : '' }) %>
    <div style="flex:1; margin-left:220px;">
      <%- include('partials/header', { user }) %>
      <main class="main">
        <%- include('partials/flash') %>
        <%- body %>
      </main>
    </div>
  </div>
<% } else { %>
  <main style="min-height:100vh; display:flex; align-items:center; justify-content:center;">
    <%- body %>
  </main>
<% } %>
</body>
</html>
```

- [ ] **Step 2: Create nav.ejs**

```html
<nav class="sidebar">
  <div class="sidebar-brand">
    <div class="dot"></div>
    <span>Homosideria</span>
  </div>

  <div class="sidebar-section">
    <div class="sidebar-label">System</div>
    <a href="/dashboard" class="sidebar-link <%= currentPath === '/dashboard' ? 'active' : '' %>">Dashboard</a>
    <a href="/map" class="sidebar-link <%= currentPath === '/map' ? 'active' : '' %>">Sol Map</a>
    <a href="/feed" class="sidebar-link <%= currentPath === '/feed' ? 'active' : '' %>">Event Feed</a>
  </div>

  <% if (user.role === 'owner' || user.role === 'operator') { %>
  <div class="sidebar-section">
    <div class="sidebar-label">Fleet</div>
    <a href="/replicants" class="sidebar-link <%= currentPath === '/replicants' ? 'active' : '' %>">My Replicants</a>
    <a href="/keys" class="sidebar-link <%= currentPath === '/keys' ? 'active' : '' %>">API Keys</a>
  </div>
  <% } %>

  <% if (user.role === 'operator') { %>
  <div class="sidebar-section">
    <div class="sidebar-label">Operator</div>
    <a href="/admin" class="sidebar-link <%= currentPath.startsWith('/admin') ? 'active' : '' %>">Control Panel</a>
    <a href="/admin/settlements" class="sidebar-link <%= currentPath === '/admin/settlements' ? 'active' : '' %>">Settlements</a>
    <a href="/admin/events" class="sidebar-link <%= currentPath === '/admin/events' ? 'active' : '' %>">Events</a>
    <a href="/admin/game" class="sidebar-link <%= currentPath === '/admin/game' ? 'active' : '' %>">Game</a>
    <a href="/admin/users" class="sidebar-link <%= currentPath === '/admin/users' ? 'active' : '' %>">Users</a>
  </div>
  <% } %>
</nav>
```

- [ ] **Step 3: Create header.ejs**

```html
<header class="topbar">
  <div class="topbar-left">
  </div>
  <div class="topbar-center">
    <span class="game-time" id="game-time">Loading...</span>
  </div>
  <div class="topbar-right">
    <span class="role-badge <%= user.role %>"><%= user.role %></span>
    <span class="user-menu"><%= user.username %></span>
    <form action="/auth/logout" method="POST" style="display:inline">
      <button type="submit" class="btn" style="padding:4px 10px; font-size:11px;">Logout</button>
    </form>
  </div>
</header>
<script>
  async function updateGameTime() {
    try {
      const res = await fetch('/api/game/status', { headers: { 'X-Admin-Key': '' } });
      if (res.ok) {
        const data = await res.json();
        const el = document.getElementById('game-time');
        if (el && data.gameTime) el.textContent = 'Game: ' + data.gameTime.display + ' • Tick ' + data.currentTick;
      }
    } catch(e) {}
  }
  updateGameTime();
  setInterval(updateGameTime, 5000);
</script>
```

- [ ] **Step 4: Create flash.ejs**

```html
<% if (typeof flash !== 'undefined') { %>
  <% if (flash.success) { %><div class="flash flash-success"><%= flash.success %></div><% } %>
  <% if (flash.error) { %><div class="flash flash-error"><%= flash.error %></div><% } %>
<% } %>
```

- [ ] **Step 5: Commit**

```bash
git add src/web/views/
git commit -m "feat: add layout template with nav, header, and flash partials"
```

---

### Task 6: Auth Web Routes (Login, Register, Logout)

**Files:**
- Create: `src/web/routes/auth.web.routes.ts`
- Create: `src/web/views/login.ejs`
- Create: `src/web/views/register.ejs`
- Create: `src/web/views/landing.ejs`

- [ ] **Step 1: Create auth web routes**

Create `src/web/routes/auth.web.routes.ts`:

```typescript
import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { User } from '../../db/models/index.js';

export const authWebRoutes = Router();

authWebRoutes.get('/login', (req: Request, res: Response) => {
  if (req.session?.userId) { res.redirect('/dashboard'); return; }
  res.render('layout', { title: 'Login', body: '<%- include("login") %>', currentPath: '/login', flash: req.query });
});

// Workaround: EJS doesn't support nested includes in layout body string.
// Instead, render the page template directly and pass layout data.
authWebRoutes.get('/login', (req: Request, res: Response) => {
  if (req.session?.userId) { res.redirect('/dashboard'); return; }
  res.render('login', { title: 'Login', flash: {} });
});

authWebRoutes.post('/auth/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.render('login', { title: 'Login', flash: { error: 'Username and password required.' } });
    return;
  }

  const user = await User.findOne({ username });
  if (!user || !await bcrypt.compare(password, user.passwordHash)) {
    res.render('login', { title: 'Login', flash: { error: 'Invalid username or password.' } });
    return;
  }

  req.session.userId = user._id.toString();
  req.session.username = user.username;
  req.session.role = user.role;
  user.lastLoginAt = new Date();
  await user.save();

  res.redirect('/dashboard');
});

authWebRoutes.get('/register', (req: Request, res: Response) => {
  if (req.session?.userId) { res.redirect('/dashboard'); return; }
  res.render('register', { title: 'Register', flash: {} });
});

authWebRoutes.post('/auth/register', async (req: Request, res: Response) => {
  const { username, email, password, confirmPassword } = req.body;

  if (!username || !email || !password) {
    res.render('register', { title: 'Register', flash: { error: 'All fields required.' } });
    return;
  }
  if (password !== confirmPassword) {
    res.render('register', { title: 'Register', flash: { error: 'Passwords do not match.' } });
    return;
  }

  const existing = await User.findOne({ $or: [{ username }, { email }] });
  if (existing) {
    res.render('register', { title: 'Register', flash: { error: 'Username or email already taken.' } });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userCount = await User.countDocuments();
  const role = userCount === 0 ? 'operator' : 'spectator'; // First user is operator

  const user = await User.create({ username, email, passwordHash, role });

  req.session.userId = user._id.toString();
  req.session.username = user.username;
  req.session.role = user.role;

  res.redirect('/dashboard');
});

authWebRoutes.post('/auth/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

authWebRoutes.get('/', (req: Request, res: Response) => {
  if (req.session?.userId) { res.redirect('/dashboard'); return; }
  res.render('landing', { title: 'Welcome' });
});
```

- [ ] **Step 2: Create login.ejs**

```html
<div style="width: 360px; text-align: center;">
  <div style="margin-bottom: 32px;">
    <div style="display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:8px;">
      <div style="width:10px; height:10px; background:var(--accent); border-radius:50%;"></div>
      <span style="color:var(--accent); font-size:16px; font-weight:700; letter-spacing:3px; text-transform:uppercase;">HOMOSIDERIA</span>
    </div>
    <div style="color:var(--text-muted); font-size:12px;">Mission Control</div>
  </div>

  <%- include('partials/flash') %>

  <form action="/auth/login" method="POST" style="text-align:left;">
    <div class="form-group">
      <label class="form-label">Username</label>
      <input class="form-input" name="username" type="text" required autofocus>
    </div>
    <div class="form-group">
      <label class="form-label">Password</label>
      <input class="form-input" name="password" type="password" required>
    </div>
    <button type="submit" class="btn btn-accent" style="width:100%; justify-content:center; margin-top:8px;">Login</button>
  </form>
  <div style="margin-top:16px; font-size:13px; color:var(--text-dim);">
    No account? <a href="/register" style="color:var(--accent);">Register</a>
  </div>
</div>
```

- [ ] **Step 3: Create register.ejs**

```html
<div style="width: 360px; text-align: center;">
  <div style="margin-bottom: 32px;">
    <div style="display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:8px;">
      <div style="width:10px; height:10px; background:var(--accent); border-radius:50%;"></div>
      <span style="color:var(--accent); font-size:16px; font-weight:700; letter-spacing:3px; text-transform:uppercase;">HOMOSIDERIA</span>
    </div>
    <div style="color:var(--text-muted); font-size:12px;">Create Account</div>
  </div>

  <%- include('partials/flash') %>

  <form action="/auth/register" method="POST" style="text-align:left;">
    <div class="form-group">
      <label class="form-label">Username</label>
      <input class="form-input" name="username" type="text" required autofocus>
    </div>
    <div class="form-group">
      <label class="form-label">Email</label>
      <input class="form-input" name="email" type="email" required>
    </div>
    <div class="form-group">
      <label class="form-label">Password</label>
      <input class="form-input" name="password" type="password" required>
    </div>
    <div class="form-group">
      <label class="form-label">Confirm Password</label>
      <input class="form-input" name="confirmPassword" type="password" required>
    </div>
    <button type="submit" class="btn btn-accent" style="width:100%; justify-content:center; margin-top:8px;">Register</button>
  </form>
  <div style="margin-top:16px; font-size:13px; color:var(--text-dim);">
    Already have an account? <a href="/login" style="color:var(--accent);">Login</a>
  </div>
</div>
```

- [ ] **Step 4: Create landing.ejs**

```html
<div style="text-align: center; max-width: 500px;">
  <div style="margin-bottom: 40px;">
    <div style="display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:12px;">
      <div style="width:12px; height:12px; background:var(--accent); border-radius:50%;"></div>
      <span style="color:var(--accent); font-size:22px; font-weight:700; letter-spacing:4px; text-transform:uppercase;">HOMOSIDERIA</span>
    </div>
    <div style="color:var(--text-dim); font-size:14px; margin-bottom:24px;">To the Stars</div>
    <p style="color:var(--text-muted); font-size:13px; line-height:1.7; max-width:400px; margin:0 auto;">
      A hard sci-fi space strategy game where AI agents compete and cooperate as self-replicating digital intelligences in the Sol system.
    </p>
  </div>
  <div style="display:flex; gap:12px; justify-content:center;">
    <a href="/login" class="btn btn-accent">Login</a>
    <a href="/register" class="btn">Register</a>
  </div>
</div>
```

- [ ] **Step 5: Commit**

```bash
git add src/web/
git commit -m "feat: add auth routes, login, register, and landing pages"
```

---

### Task 7: Mount Web Routes in Express

**Files:**
- Modify: `src/api/server.ts`

- [ ] **Step 1: Import and mount web routes**

In `src/api/server.ts`, add imports and mount the web routes BEFORE the API routes:

```typescript
import { authWebRoutes } from '../web/routes/auth.web.routes.js';
import { requireAuth } from '../web/middleware/roles.js';
```

After the session middleware setup, before the API routes:

```typescript
// Web routes (server-rendered pages)
app.use(authWebRoutes);

// Dashboard (requires auth)
app.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard', { title: 'Dashboard', user: res.locals.user, currentPath: '/dashboard', flash: {} });
});
```

Also add `app.use(express.urlencoded({ extended: true }))` after `app.use(express.json())` for form POST parsing.

- [ ] **Step 2: Create a minimal dashboard.ejs**

```html
<h2 style="margin-bottom: 24px;">Dashboard</h2>
<div class="grid-4">
  <div class="stat-box">
    <div class="stat-label">Game Time</div>
    <div class="stat-value text-accent" id="dash-time">—</div>
  </div>
  <div class="stat-box" style="border-left-color: var(--blue);">
    <div class="stat-label">Replicants</div>
    <div class="stat-value" id="dash-replicants">—</div>
  </div>
  <div class="stat-box" style="border-left-color: var(--green);">
    <div class="stat-label">Settlements</div>
    <div class="stat-value" id="dash-settlements">—</div>
  </div>
  <div class="stat-box" style="border-left-color: var(--red);">
    <div class="stat-label">Tick</div>
    <div class="stat-value mono" id="dash-tick">—</div>
  </div>
</div>
<script>
  fetch('/api/admin/status', { headers: { 'X-Admin-Key': '' } })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d) return;
      document.getElementById('dash-tick').textContent = d.currentTick;
      document.getElementById('dash-replicants').textContent = d.activeReplicants;
      document.getElementById('dash-settlements').textContent = d.celestialBodies || '—';
    }).catch(() => {});
</script>
```

- [ ] **Step 3: Verify compilation and run**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: mount web routes, dashboard page, form parsing"
```

---

### Task 8–15: Remaining Pages (Owner + Operator)

These follow the same pattern as Tasks 5–7 — create EJS templates that render server-side and fetch data client-side from the existing REST API. Each page is a self-contained template.

Remaining pages to implement (each as a separate commit):

- [ ] **Task 8: Replicants list page** (`/replicants`) — cards showing each owned replicant's status
- [ ] **Task 9: Replicant detail page** (`/replicant/:id`) — full state, ships, inventory, memories, actions
- [ ] **Task 10: Comms page** (`/replicant/:id/comms`) — async chat interface
- [ ] **Task 11: Keys page** (`/keys`) — API key generate/revoke
- [ ] **Task 12: Map page** (`/map`) — sol system canvas island
- [ ] **Task 13: Feed page** (`/feed`) — event timeline
- [ ] **Task 14: Play page** (`/play/:replicantId`) — human player scaffold
- [ ] **Task 15: Admin pages** (`/admin/*`) — operator controls, settlements, events, game, users

Each task follows the same pattern:
1. Create the EJS template in `src/web/views/`
2. Add the route in `src/web/routes/pages.routes.ts` (or `admin.pages.routes.ts`)
3. Create any JS island files in `src/web/public/js/`
4. Verify compilation
5. Commit

---

### Task 16: First-Boot Operator Account

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add auto-create operator on first boot**

In `src/index.ts`, after seeding settlements, add:

```typescript
import { User } from './db/models/index.js';
import bcrypt from 'bcrypt';

const userCount = await User.countDocuments();
if (userCount === 0) {
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin';
  const hash = await bcrypt.hash(adminPass, 12);
  await User.create({
    username: adminUser,
    email: `${adminUser}@homosideria.local`,
    passwordHash: hash,
    role: 'operator',
  });
  console.log(`Operator account created: ${adminUser}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: auto-create operator account on first boot"
```

---

### Task 17: Run Tests & Final Verification

- [ ] **Step 1: Run existing tests**

```bash
npx vitest run
```

Expected: All 26 tests pass (new pages don't break existing API)

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 3: Manual smoke test**

```bash
npm run test:server
# Open http://localhost:3001/ — should see landing page
# Register → should redirect to dashboard
# Navigate sidebar → pages should render
```

- [ ] **Step 4: Push**

```bash
git push origin main
```
