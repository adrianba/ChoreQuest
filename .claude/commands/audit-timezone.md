# Timezone & Day-Boundary Audit

Perform a targeted audit of the entire backend for timezone and day-boundary bugs.
This codebase has been bitten by these repeatedly — the TZ env var sets the container
to a local timezone (e.g. America/Chicago, CDT = UTC-5), so UTC-midnight != local midnight.

## What to scan for

Search `backend/` for every occurrence of these patterns and evaluate each one:

1. **`datetime.now(timezone.utc)` used for day-boundary logic**
   - Safe: storing audit timestamps (`created_at`, `updated_at`, `last_used_at`)
   - Safe: token expiry comparisons (JWT exp, RefreshToken.expires_at)
   - DANGER: `.replace(hour=0, ...)` to compute "start of today"
   - DANGER: `.date()` used in a "is this today / is this yesterday?" comparison
   - DANGER: passed to `should_advance_rotation()` or any function that calls `.date()`

2. **`datetime.utcnow()` anywhere** — deprecated since Python 3.12, and always UTC

3. **Hardcoded timezone strings** (`ZoneInfo('America/Chicago')`, `'US/Central'`, etc.)
   — should read from `os.environ.get("TZ", "UTC")` instead

4. **`datetime.now(timezone.utc).replace(hour=0, ...)` or `.replace(tzinfo=None)`**
   — the classic "UTC midnight as today's boundary" mistake

5. **Scheduler / background task timing** — any `asyncio.sleep` loop that computes
   next-run time; must use local `datetime.now()` not UTC

6. **Frontend `new Date()` comparisons** — JS `Date` is local-time-aware but
   check any manual ISO string parsing or `.getUTCDate()` / `.getUTCHours()` calls
   that are used for "is this today?" logic in `frontend/src/`

## For each hit, report

- File + line number
- The exact pattern found
- Whether it's safe (UTC is correct for this use) or a bug (should be local time)
- The fix if it's a bug

## Known-safe patterns (do not flag)

- `datetime.now(timezone.utc)` for `updated_at`, `created_at`, `last_used_at`, `expires_at`
- `datetime.now(timezone.utc)` compared against other UTC-stored timestamps
- `date.today()` — already returns local date, always correct
- `datetime.now()` (no tz arg) — already correct, uses local clock
