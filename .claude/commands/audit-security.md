# Security Audit

Scan the codebase for common security issues specific to this app's stack
(FastAPI + SQLAlchemy async + JWT/cookie auth + SQLite + file uploads).

## What to look for

### Auth & authorization
- Endpoints that use `get_current_user` but never check `user.role` — any kid
  reaching a parent-only action
- Endpoints using `require_parent` — verify the decorator is actually applied,
  not just imported
- Direct object reference: fetching a record by ID without checking it belongs
  to the requesting user (e.g. a kid fetching another kid's assignments)
- API key scope checks — does each scoped endpoint actually enforce the scope,
  or just check that a key exists?

### File uploads
- `MAX_UPLOAD_SIZE_MB` enforced on every upload endpoint?
- Filename sanitization — is `uuid` used for stored filenames everywhere, or
  is any user-supplied filename used directly?
- MIME type / extension validation — can a user upload a `.php` or `.html` file?

### Input validation
- Any `eval()`, `exec()`, or dynamic SQL string interpolation
- JSON fields stored as raw strings and later parsed without validation
- Integer overflows in XP/points arithmetic (very large point awards)

### Secrets / data exposure
- Any endpoint that returns password_hash, api_key raw value, or VAPID keys
- Error messages that leak stack traces to the client in production
- Admin-only data leaking through public endpoints (public dashboard, kiosk)

### Rate limiting
- Authentication endpoints (login, register) — any rate limiting?
- Photo upload endpoint — can a user spam uploads to fill disk?
- Spin wheel — server-side enforcement, or just client-side disabled button?

## Report format

For each issue: file, line, severity (critical/high/medium/low), description,
and recommended fix. Skip anything that's already clearly handled.
