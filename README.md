# ⚔️ ChoreQuest

> *Turn chores into quests, kids into heroes.*

A gamified family chore management app with full RPG theming. Parents create quests, assign them to kids with per-child schedules, and kids earn XP by completing them.

> **This is a personal fork** of [ChoreQuest](https://github.com/finalbillybong/ChoreQuest) by [finalbillybong](https://github.com/finalbillybong), maintained with additional bug fixes, features, and improvements.

---

## ✨ Features

| | |
|---|---|
| 🗡️ **Quest Board** | Daily quest carousel with animated cards, tap to complete or attach photo proof |
| ⭐ **XP, Ranks & Streaks** | Earn XP per quest, climb 8 rank tiers, build daily streaks with freeze protection |
| 🎭 **Custom Avatars** | Full SVG editor — heads, hair, eyes, mouths, hats, gear, outfits, body shapes |
| 🐾 **Pets** | 6 companions that level up through 8 tiers; feed, pet, and play daily for bonus XP |
| 🛒 **Avatar Shop** | Unlock items by spending XP, reaching milestones, or random quest drops |
| 🎰 **Daily Spin Wheel** | Bonus XP wheel — earn spins from fully completed daily quests, carry unused spins forward |
| 🏪 **Treasure Shop** | Parents create rewards, kids redeem with XP |
| 📋 **Wishlist** | Kids add wish items; parents convert them into rewards |
| 🔄 **Quest Trading** | Siblings swap quests via the calendar with real-time notifications |
| 🏆 **Leaderboard** | Weekly XP rankings with streaks, ranks, and pet levels |
| 📅 **Calendar** | Weekly view with auto-generated recurring assignments and parent override verify |
| 🎉 **Seasonal Events** | Time-limited XP multiplier events |
| 🏖️ **Vacation Mode** | Pause quests per-kid or family-wide, streaks preserved automatically |
| 📊 **Progress Charts** | 30-day XP, quests completed, and completion rate charts |
| 🎊 **Party Page** | Family hub with bulletin board, shoutouts, avatars, and emotes |
| 🏅 **Tiered Achievements** | Bronze, Silver, and Gold tiers with downloadable SVG badges |
| ❄️ **Streak Freeze** | Auto streak protection once per calendar month |
| 🔔 **Push Notifications** | Web Push (VAPID) for quests, achievements, trades, and more |
| 📱 **Installable PWA** | Add to home screen on any device |
| 🛡️ **Admin Tools** | User management, API keys with scopes, invite codes, and audit log |
| 📺 **Kiosk / Wall Display** | Full-screen family dashboard for TVs and wall tablets |

---

## 🚀 Quick Start

### Requirements

- Docker + Docker Compose

### Run

```bash
git clone https://github.com/turbogizzmo/ChoreQuest.git
cd ChoreQuest
```

Create a `.env` file:

```env
SECRET_KEY=your-secret-key-min-16-chars
TZ=America/Chicago
```

Start the app:

```bash
docker-compose up -d --build
```

App runs on port **8122**. The first user to register becomes admin. After that, new accounts require an invite code (generate from the Admin dashboard).

### Updating

```bash
git pull && docker-compose up -d --build
```

Your data (`./data`) is preserved across rebuilds. The Admin Dashboard shows a banner when a newer version is available on GitHub.

#### Auto-update with the host watchdog (optional)

ChoreQuest has a built-in one-click update flow. When a new version is available, an admin clicks **Apply Update** in Settings — the app writes a flag file to `./data/.update_requested`, and a lightweight host-side script picks it up and handles the rest.

Run `watchdog.sh` once on the host (outside Docker):

```bash
nohup bash /path/to/ChoreQuest/watchdog.sh >> /path/to/ChoreQuest/data/watchdog.log 2>&1 &
```

Or add it as a cron job that checks every minute:

```cron
* * * * * /bin/bash /path/to/ChoreQuest/watchdog.sh --cron >> /path/to/ChoreQuest/data/watchdog.log 2>&1
```

When triggered, `watchdog.sh` runs `deploy.sh` which does `git pull` + `docker compose build --no-cache` + `docker compose up -d`. The app shows a full-screen update overlay to all connected users during the rebuild and auto-reloads when the new container is ready.

---

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | *required* | JWT signing key, min 16 characters |
| `TZ` | `Europe/London` | Container timezone |
| `REGISTRATION_ENABLED` | `false` | Allow public self-registration |
| `DATABASE_URL` | `sqlite+aiosqlite:////app/data/chores_os.db` | Database path |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Access token lifetime |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | Refresh token lifetime |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `CORS_ORIGINS` | *(empty)* | Comma-separated allowed origins |
| `MAX_UPLOAD_SIZE_MB` | `5` | Photo proof upload size limit |
| `DAILY_RESET_HOUR` | `0` | Hour (local time, respects `TZ`) the daily quest reset runs |
| `GITHUB_REPO` | `turbogizzmo/ChoreQuest` | Repo used for in-app update checks |
| `VAPID_PUBLIC_KEY` | *(empty)* | VAPID public key for push notifications |
| `VAPID_PRIVATE_KEY` | *(empty)* | VAPID private key for push notifications |
| `VAPID_CLAIM_EMAIL` | `mailto:admin@example.com` | Contact email for push requests |

### Data persistence

All data lives in `./data`:
- `chores_os.db` — SQLite database
- `uploads/` — photo proof files

Back up this directory to preserve everything.

---

## 🔔 Push Notifications

Generate VAPID keys once:

```bash
npx web-push generate-vapid-keys
```

Add to `.env`:

```env
VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
VAPID_CLAIM_EMAIL=mailto:you@example.com
```

> Push notifications require HTTPS. See [External Access](#-external-access) below.

---

## 🌐 External Access

ChoreQuest works well behind a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) — free HTTPS, no port forwarding required.

```env
COOKIE_SECURE=true   # add this when running behind HTTPS
```

### Install as a PWA

Once on HTTPS:
- **iOS Safari** — Share → *Add to Home Screen*
- **Android Chrome** — Menu → *Install app*
- **Desktop Chrome/Edge** — Install icon in address bar

---

## 🔑 API

ChoreQuest exposes a full REST API. Two auth methods:

**JWT Bearer** (web app):
```
Authorization: Bearer <token>
```

**API Key** (automation/integrations):
```
X-API-Key: <your-api-key>
```

Generate API keys in **Admin → API Keys**. Keys authenticate as the creating admin and never expire unless revoked.

### Public dashboard (no auth)

```
GET /api/public/dashboard?token=<share-token>
```

Generate the share token in **Settings → Family Dashboard**. Add `?kiosk=1` for full-screen wall-display mode.

### Interactive docs

Full Swagger UI at `/docs` and ReDoc at `/redoc` when the server is running.

→ See the [API Reference wiki page](https://github.com/turbogizzmo/ChoreQuest/wiki/API-Reference) for the full endpoint list and examples.

---

## 🧪 Testing

```bash
./run-e2e.sh          # all E2E tests headless
./run-e2e.sh --ui     # Playwright visual UI
./run-e2e.sh --report # HTML report from last run
python3 -m pytest tests/unit/  # backend unit tests
```

Tests use an isolated environment — production data is never touched.

---

## 🧱 Tech Stack

| | |
|---|---|
| **Backend** | Python / FastAPI (async) |
| **Database** | SQLite (WAL mode) |
| **ORM** | SQLAlchemy 2.0 (async) |
| **Frontend** | React 18, Vite, Tailwind CSS 4 |
| **Animations** | Framer Motion |
| **Real-time** | WebSocket (per-user channels) |
| **Push** | Web Push / VAPID |
| **Auth** | JWT + httpOnly cookies, bcrypt, optional PIN |
| **Deployment** | Docker, single container |
| **Testing** | Playwright (E2E) · pytest (unit) · GitHub Actions CI |

---

## 📖 Wiki

Detailed documentation lives in the [GitHub Wiki](https://github.com/turbogizzmo/ChoreQuest/wiki):

- [Assignment System](https://github.com/turbogizzmo/ChoreQuest/wiki/Assignment-System) — recurrence, grace period, auto-generation
- [Streaks & Vacation](https://github.com/turbogizzmo/ChoreQuest/wiki/Streaks-and-Vacation) — streak logic, freeze, vacation mode
- [Rotation System](https://github.com/turbogizzmo/ChoreQuest/wiki/Rotation-System) — cadences, inverse linking
- [Parent Tools](https://github.com/turbogizzmo/ChoreQuest/wiki/Parent-Tools) — calendar, verify override, bounty board, audit log
- [Achievements & Ranks](https://github.com/turbogizzmo/ChoreQuest/wiki/Achievements-and-Ranks) — tiers, XP thresholds
- [Avatar & Pets](https://github.com/turbogizzmo/ChoreQuest/wiki/Avatar-and-Pets) — editor, pet levels, drops
- [API Reference](https://github.com/turbogizzmo/ChoreQuest/wiki/API-Reference) — full endpoint list and examples
- [Troubleshooting](https://github.com/turbogizzmo/ChoreQuest/wiki/Troubleshooting) — common issues and debug tools

---

## 🙏 Credits

Forked from [ChoreQuest](https://github.com/finalbillybong/ChoreQuest) by [finalbillybong](https://github.com/finalbillybong). Original concept, design, and core implementation by the upstream author.
