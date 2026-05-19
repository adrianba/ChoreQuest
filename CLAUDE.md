# ChoreQuest — Claude Code Context

## Project overview

Gamified family chore app. FastAPI backend, React/Vite frontend, SQLite (WAL),
Docker single-container. Kids earn XP by completing chores; parents manage quests,
rotations, and rewards.

Key entry points:
- `backend/main.py` — app startup, daily reset scheduler
- `backend/routers/` — all API endpoints
- `backend/services/` — rotation logic, assignment generation, streak service
- `frontend/src/pages/` — page components
- `frontend/src/components/` — shared UI

## ⚠️ Known antipatterns — do not repeat these

These bugs have been found and fixed. Flag immediately if you see them again.

### 1. UTC midnight used as a day boundary
```python
# WRONG — fires at 7 pm CDT for a US Central family
datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

# CORRECT — respects TZ env var
datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
```
Affects: scheduler timing, bounty expiry, any "start of today" cutoff.

### 2. `datetime.now(timezone.utc)` passed to `should_advance_rotation()`
`should_advance_rotation()` calls `.date()` on the value for calendar-day
comparisons. UTC `.date()` is already "tomorrow" after 7 pm CDT.
```python
# WRONG
now = datetime.now(timezone.utc)
should_advance_rotation(rotation, now)

# CORRECT
now = datetime.now()   # local time
should_advance_rotation(rotation, now)
```

### 3. Hardcoded timezone strings
```python
# WRONG
_LOCAL_TZ = ZoneInfo('America/Chicago')

# CORRECT
_LOCAL_TZ = ZoneInfo(os.environ.get("TZ", "UTC"))
```

### 4. `assign_chore` resetting rotation state on re-save
When editing cadence or photo settings without changing `kid_ids`, do NOT
reset `current_index` or `last_rotated`. Only reset when the kid list changes.
See `backend/routers/chores.py` — `kids_changed` guard.

### 5. Rotation display trusting `current_index` raw
After UTC midnight (= 7 pm CDT), `current_index` already points to tomorrow's
kid. The display layer must prefer today's actual `ChoreAssignment.date` over
raw `current_index`. See `build_rotation_summaries` in `_chores_helpers.py`.

## Safe vs unsafe `datetime.now` usage

| Pattern | When it's correct |
|---|---|
| `datetime.now(timezone.utc)` | Storing audit timestamps (`created_at`, `updated_at`, `expires_at`, `last_used_at`) |
| `datetime.now(timezone.utc)` | Comparing against other UTC-stored timestamps (token expiry, event ranges) |
| `datetime.now()` | Scheduler timing, day-boundary comparisons, anything using `.date()` |
| `date.today()` | Always correct — returns local date |

## Architecture notes

- **Daily reset** fires at `DAILY_RESET_HOUR` in **local time** (respects `TZ`).
  Code: `datetime.now()` loop in `backend/main.py::daily_reset_task`.
- **Assignment dates** are stored as `date` (no time component) using local date.
- **Timestamps** (`created_at` etc.) are stored as naive UTC datetimes (SQLite
  has no timezone type). `datetime.utcnow` defaults are deprecated — prefer
  `lambda: datetime.now(timezone.utc)` for new columns.
- **Rotation `last_rotated`** is stored UTC. `should_advance_rotation` compares
  `.date()` values — pass local `now` so `.date()` is the local calendar date.

## Audit commands

Run these slash commands periodically or before merging large refactors:

- `/audit-timezone` — find UTC-vs-local day-boundary issues
- `/audit-security` — auth, file upload, rate limiting, data exposure
- `/audit-data-integrity` — silent data corruption, race conditions, XP math
