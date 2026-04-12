# Mission Control Redesign — Design Spec

## Context

Homosideria's current dashboard is a single 2900-line HTML file with a dark terminal aesthetic, a shared admin key, and no user accounts. It needs to become a proper multi-user web application with authentication, role-based access, replicant management, and a human gameplay interface.

## Decisions Made

- **Roles**: Operator (game master), Agent Owner (replicant manager), Spectator (read-only)
- **Tech**: Server-rendered Express + EJS with interactive JS islands. No framework, no build step.
- **Auth**: Username/password with bcrypt, Express sessions stored in MongoDB
- **Visual**: Industrial/aerospace — black backgrounds, amber/gold accents, left-border indicators, uppercase labels, system-ui fonts
- **Human play**: Scaffold with essentials (ship status, map, scan, move, mine, trade) — not full client

---

## 1. User Model

New `User` model in MongoDB (separate from `Replicant`):

```
User {
  username: string (unique)
  email: string (unique)
  passwordHash: string (bcrypt)
  role: 'operator' | 'owner' | 'spectator'
  replicantIds: ObjectId[]     // replicants this user owns
  apiKeys: [{                  // generated API keys for their agents
    key: string
    name: string               // label like "Bob's Claude Code"
    replicantId: ObjectId
    createdAt: Date
    lastUsedAt: Date
    active: boolean
  }]
  createdAt: Date
  lastLoginAt: Date
}
```

On first boot, if no users exist, prompt to create an operator account (or auto-create from env vars `ADMIN_USERNAME` / `ADMIN_PASSWORD`).

## 2. Authentication

- `express-session` with `connect-mongo` session store (uses the existing MongoDB)
- Login: POST `/auth/login` — validates password, creates session, redirects to dashboard
- Register: POST `/auth/register` — creates user with `spectator` role by default. Operator can promote.
- Logout: POST `/auth/logout` — destroys session
- Session cookie: `homosideria.sid`, httpOnly, 7 day expiry
- Middleware: `requireAuth` (any logged-in user), `requireRole('operator')`, `requireRole('owner')`

## 3. Pages

### Public (no auth)
| Route | Template | Description |
|-------|----------|-------------|
| `GET /` | `landing.ejs` | Game intro + login/register links |
| `GET /login` | `login.ejs` | Login form |
| `GET /register` | `register.ejs` | Signup form |

### Spectator+ (any logged-in user)
| Route | Template | Description |
|-------|----------|-------------|
| `GET /dashboard` | `dashboard.ejs` | Overview: game time, active replicants, recent events, system status |
| `GET /map` | `map.ejs` | Interactive Sol system map (canvas island). Shows bodies, ships (fog of war for non-operators), settlements |
| `GET /feed` | `feed.ejs` | Event timeline: tick events, broadcasts, MC actions. Filterable. |

### Agent Owner+ (owns replicants)
| Route | Template | Description |
|-------|----------|-------------|
| `GET /replicants` | `replicants.ejs` | List of user's replicants with status cards |
| `GET /replicant/:id` | `replicant.ejs` | Detail: profile, ships, inventory, structures, colonies, memories, action log |
| `GET /replicant/:id/comms` | `comms.ejs` | Chat interface — send messages to the replicant, see their inbox |
| `GET /play/:replicantId` | `play.ejs` | Human player interface — ship status, map, action buttons |
| `GET /keys` | `keys.ejs` | API key management — generate, revoke, see usage |
| `POST /replicants/create` | — | Create a new replicant (redirect to detail) |

### Operator only
| Route | Template | Description |
|-------|----------|-------------|
| `GET /admin` | `admin/index.ejs` | Operator dashboard: all replicants, system health, notifications |
| `GET /admin/settlements` | `admin/settlements.ejs` | Settlement manager: edit attitudes, leaders, markets |
| `GET /admin/events` | `admin/events.ejs` | Event injector: broadcast, suggest, world events |
| `GET /admin/game` | `admin/game.ejs` | Game controls: force tick, time dilation, MC settings |
| `GET /admin/users` | `admin/users.ejs` | User management: promote roles, view accounts |

## 4. Shared Layout

All pages use `layout.ejs` which provides:

**Top bar** (52px):
- Left: Homosideria logo + amber dot indicator
- Center: Game time display (dilated time + tick count)
- Right: User menu (username, role badge, logout)

**Left sidebar** (220px, collapsible):
- Navigation grouped by section
- Spectator: Dashboard, Map, Feed
- Owner: My Replicants, Keys, Play (if has replicants)
- Operator: Admin section with sub-items
- Active page highlighted with amber left-border

**Main content area**:
- Renders the page template
- Max-width container for readability
- Responsive — sidebar collapses on narrow screens

## 5. Visual Design — Industrial Aerospace

```css
/* Core palette */
--bg:           #0c0c0c;
--surface:      #171717;
--surface-alt:  #1a1a1a;
--border:       #2a2a2a;
--border-light: #333333;
--text:         #fafafa;
--text-dim:     #a3a3a3;
--text-muted:   #737373;
--accent:       #f59e0b;    /* amber/gold */
--accent-dim:   #f59e0b22;
--green:        #22c55e;
--red:          #ef4444;
--blue:         #3b82f6;

/* Typography */
font-family: system-ui, -apple-system, sans-serif;
Monospace for data: 'JetBrains Mono', monospace;
Labels: uppercase, letter-spacing: 1-2px, font-size: 10-11px

/* Key patterns */
- Left-border indicators (3px solid amber) for active/important items
- Cards with subtle borders, no rounded corners (or 4px max)
- Stat boxes: dark bg, uppercase label, large number
- Status badges: colored left-border or dot, not background fills
- Tables: minimal, row hover with subtle bg change
```

## 6. Interactive Islands

These sections use vanilla JS loaded as ES modules:

### Sol Map (`public/js/map.js`)
- Canvas-based 2D top-down view of the solar system
- Renders: Sun, planets, moons, ships, asteroids, settlements
- Controls: zoom (scroll), pan (drag), click bodies/ships for info popup
- Data source: fetches from `/api/public/bodies` + admin endpoints for ships
- Refreshes on a timer (every 5 seconds to match tick interval)

### Play Interface (`public/js/play.js`)
- Left panel: ship status (hull, fuel, cargo bars), position info
- Center: contextual action area — changes based on what you can do at your location
- Right panel: event log / messages
- Actions available in v1: scan, move (dropdown of known bodies), start/stop mining, trade (if at settlement), fabricate (autofactory recipes), repair
- Each action calls the REST API and shows the result inline

### Replicant Detail (`public/js/replicant-detail.js`)
- Live-updating resource bars
- Action log with expandable entries
- Memory browser with category filters
- Ship/structure/colony cards

### Real-time Feed (`public/js/feed.js`)
- Polls `/api/admin/actions`, `/api/admin/ticks`, notifications
- Renders as a timeline with event type icons
- Filterable by type

## 7. API Key Management

Agent Owners can create API keys for their replicants:

1. User clicks "Generate Key" on the keys page
2. Selects which replicant the key is for (from their owned list)
3. Gives it a label (e.g., "Claude Code — mining bot")
4. System generates an `hs_${nanoid(32)}` key and assigns it to that replicant
5. Key is shown once, then only the last 4 chars are visible
6. User can revoke keys (sets `active: false`)

The existing Replicant `apiKey` field remains — the User's apiKeys are additional keys that also work for authentication.

## 8. Replicant ↔ User Binding

When a User creates a replicant through the web UI:
1. `POST /api/auth/register` is called internally with a password
2. The new replicant's ID is added to `user.replicantIds`
3. An API key is auto-generated and stored in `user.apiKeys`

When an agent creates a replicant via MCP `replicate` tool:
- A Notification is created (already exists)
- The operator sees it in the admin dashboard
- Operator can assign the new replicant to a user

## 9. Replicant Comms (Owner ↔ Replicant Chat)

The comms page (`/replicant/:id/comms`) provides:
- A chat-style interface showing the replicant's message inbox/outbox
- The user can type a message that gets delivered as a system message to the replicant
- Uses the existing `POST /api/admin/suggest` endpoint (or a new user-facing version)
- Shows the replicant's memories tagged 'captains_log' as their "voice"
- Not real-time chat — it's async messaging with the game's light-speed delay feel

## 10. File Structure

```
src/
  web/
    views/
      layout.ejs            # shared shell
      partials/
        nav.ejs             # sidebar navigation
        header.ejs          # top bar
        flash.ejs           # success/error messages
      landing.ejs
      login.ejs
      register.ejs
      dashboard.ejs
      map.ejs
      feed.ejs
      replicants.ejs
      replicant.ejs
      comms.ejs
      play.ejs
      keys.ejs
      admin/
        index.ejs
        settlements.ejs
        events.ejs
        game.ejs
        users.ejs
    public/
      css/
        style.css           # industrial aerospace theme
      js/
        map.js              # sol map canvas
        play.js             # human player interface
        replicant-detail.js # live replicant data
        feed.js             # event timeline
    routes/
      auth.routes.ts        # login, register, logout
      pages.routes.ts       # all page renders
      admin-pages.routes.ts # operator pages
    middleware/
      session.ts            # session config
      roles.ts              # requireAuth, requireRole
  db/models/
    User.ts                 # new model
```

## 11. Dependencies to Add

```
express-session     # session management
connect-mongo       # MongoDB session store
bcrypt              # password hashing
ejs                 # template engine
```

## 12. Migration Path

- The existing `public/dashboard.html` stays functional during development
- New pages are served from `/` (web routes) while old dashboard remains at `/dashboard`
- Once the new pages cover all functionality, the old dashboard is removed
- Existing REST API endpoints are unchanged — the new frontend is just another consumer

## 13. Out of Scope for v1

- WebSocket/SSE real-time updates (polling is fine)
- Email verification
- Password reset
- Two-factor auth
- Mobile-specific layouts (responsive is enough)
- Full human gameplay client (scaffold only)
