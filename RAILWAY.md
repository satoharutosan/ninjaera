# Railway Production Deployment

Public URL (example): `https://ninjaera.up.railway.app`

This app ships as a **single Docker service**: Express API + built Vite SPA (`SPA_DIR`).

## Root cause of the previous Docker failure

```
Syntax error - can't find = in "Era"
```

Came from an **unquoted** Dockerfile env:

```dockerfile
ENV MAIL_FROM_NAME=Ninja Era
```

Docker `ENV` requires `name=value`. Unquoted spaces split the line, so `Era` was parsed as a second token without `=`.

**Fix:** `ENV MAIL_FROM_NAME="Ninja Era"`

## One-time Railway setup

1. Create a **Postgres** plugin/service and link it (provides `DATABASE_URL`).
2. Deploy this repo with the root `Dockerfile` (`railway.toml` already sets `builder = DOCKERFILE`).
3. Set the variables below in the service **Variables** tab.
4. For durable uploads, configure **S3/R2** (recommended). A volume at `/data` is only a fallback for local SQLite/uploads.
5. Update OAuth redirect URIs to the Railway URL (see below).

## Required variables

| Variable | Example / notes |
|----------|-----------------|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | ≥32 random chars (startup fails without it) |
| `JWT_EXPIRES_IN` | `7d` (recommended) |
| `DATABASE_URL` | Auto from Railway Postgres plugin |
| `DATABASE_PROVIDER` | `postgres` (optional if `DATABASE_URL` is set — auto-detected) |
| `CORS_ORIGIN` | `https://ninjaera.up.railway.app` |
| `FRONTEND_URL` | `https://ninjaera.up.railway.app` |
| `OAUTH_CALLBACK_BASE` | `https://ninjaera.up.railway.app` |

`PORT` is injected by Railway — do not hardcode it in the dashboard.

## Database (PostgreSQL on Railway, SQLite locally)

The app runs on both engines through one adapter (`backend/src/db/adapter.ts`).

- **Local:** SQLite by default (`DATABASE_PROVIDER=sqlite`, file under the data dir).
- **Railway:** PostgreSQL. Set `DATABASE_URL` (auto from the Postgres plugin). `DATABASE_PROVIDER=postgres` is inferred when `DATABASE_URL` is present.

### Automatic schema initialization

On every boot (`initializeDatabase()` in `backend/src/db/startup.ts`) the app:

1. Logs the **provider** and engine **version**.
2. Reports **applied vs. pending migrations** and the current **schema version**.
3. Runs any **pending migrations automatically** (versioned, idempotent, ordered).
4. **Validates** that every required table exists.
5. **Aborts startup** with a clear error if the schema is incomplete — it never serves traffic on a half-built database.

Example startup log:

```
[db] provider: postgres (PostgreSQL)
[db] version:  16.4
[db] migrations known:   3 [001_initial_schema, 002_legacy_columns, 003_site_content]
[db] migrations applied: 0
[db] migrations pending: 3 [...]
[db] schema version: 003_site_content
[db] schema validation: OK (32 required tables present)
```

You never need to edit the database by hand. To reset locally, delete the SQLite file; on Railway, migrations re-run automatically against the linked Postgres.

### Portable queries (no SQLite-only assumptions)

The Postgres adapter translates SQLite idioms: `?`→`$n` params, `INSERT OR IGNORE`→`ON CONFLICT DO NOTHING`, and it emulates `lastInsertRowid` by appending `RETURNING id` **only** to inserts on tables that actually have an `id` column. Tables keyed by something else (`oauth_states` = `state`, `password_reset_tokens` = `token_hash`, composite-PK join tables) are inserted without `RETURNING id`. Schema errors (undefined column/table) are logged with the offending SQL, table, column, and a suggested cause.

## Mail (email verification / password reset)

The mail subsystem is split into configurable modules:

- **Transport** (`mailTransport.ts`) — how messages are delivered.
- **Templates + retry** (`mail.ts`) — Ninja Era branded HTML (Cloudinary logo, Trade Winds title), retry/backoff, error classification.

Provider is switchable **entirely via environment variables** — no code changes.

Railway frequently **cannot** open outbound SMTP connections (Gmail shows `ETIMEDOUT` / `ENETUNREACH` on IPv6, and even provider SMTP ports can be blocked). The most reliable option on Railway is Resend's **HTTP API** (port 443).

### Recommended: Resend HTTP API (Railway-friendly, no SMTP ports)

| Variable | Value |
|----------|-------|
| `SMTP_PROVIDER` | `resend` |
| `RESEND_API_KEY` | Resend API key (dashboard only) |
| `MAIL_FROM_NAME` | `Ninja Era` |
| `MAIL_FROM_ADDRESS` | A sender on your **verified** Resend domain |

When `RESEND_API_KEY` is present the app delivers via `https://api.resend.com/emails` automatically. Set `MAIL_TRANSPORT=smtp` to force SMTP instead.

### Resend over SMTP (alternative)

| Variable | Value |
|----------|-------|
| `SMTP_PROVIDER` | `resend` |
| `SMTP_USER` | `resend` |
| `SMTP_PASS` | Resend API key |
| `MAIL_TRANSPORT` | `smtp` (only if you want SMTP instead of the HTTP API) |

Other SMTP presets (host/port auto-filled): `sendgrid`, `mailgun`, `ses`, `brevo`, `gmail`.

### Gmail (not reliable on Railway)

| Variable | Notes |
|----------|-------|
| `SMTP_PROVIDER` | `gmail` or omit |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | Gmail address |
| `SMTP_PASS` | **Google App Password** only |
| `SMTP_IP_FAMILY` | `4` (default) — forces IPv4 DNS/connect |

Startup logs print a clear `MAIL UNAVAILABLE` banner if verify fails. `/api/health` includes `mail.transport`, `mail.provider`, and `mail.verified` (no secrets). Signup still **requires** working mail (email-dependent endpoints return **503** if unset/broken) — the rest of the app keeps functioning and auth is not weakened.

## OAuth redirect URIs

Register these exact callbacks with each provider:

- Google: `{OAUTH_CALLBACK_BASE}/api/auth/oauth/google/callback`
- GitHub: `{OAUTH_CALLBACK_BASE}/api/auth/oauth/github/callback`
- Discord: `{OAUTH_CALLBACK_BASE}/api/auth/oauth/discord/callback`

Also set `GOOGLE_*`, `GITHUB_*`, `DISCORD_*` client id/secret in Railway Variables.

## Storage (uploads must outlive deploys)

| Variable | Notes |
|----------|-------|
| `STORAGE_PROVIDER` | `s3` recommended on Railway |
| `S3_BUCKET` / `S3_ENDPOINT` / `S3_REGION` | R2/S3/MinIO |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Secrets |
| `S3_FORCE_PATH_STYLE` | `true` for R2/MinIO often |

Local `STORAGE_PROVIDER=local` + volume mount `/data` works, but **re-deploys without a volume wipe uploads**. Prefer object storage.

## Super Admin bootstrap

On every boot the API ensures a Super Admin exists (`ensureSuperAdmin`):

| Variable | Notes |
|----------|-------|
| `SUPER_ADMIN_EMAIL` | Defaults to `admin@ninjaera.com` — must match the account email |
| `SEED_ADMIN_EMAIL` | Optional override used when creating the account (defaults to `SUPER_ADMIN_EMAIL`) |
| `SEED_ADMIN_USERNAME` | Defaults to `admin` |
| `SEED_ADMIN_PASSWORD` | **Set this in Railway** (≥12 chars). If omitted in production, a one-time random password is logged at startup — change it immediately. |

Login at `/#/login` with that email/password after deploy.

## Optional bootstrap (legacy empty-DB notes)

| Variable | Notes |
|----------|-------|
| `SEED_ADMIN_EMAIL` | Creates first admin if missing |
| `SEED_ADMIN_PASSWORD` | ≥12 characters (recommended) |
| `SEED_ADMIN_USERNAME` | Defaults to `admin` |
| `SUPER_ADMIN_EMAIL` | Identity used for Super Admin privileges |

## Health check

- Path: `/api/health` (configured in `railway.toml`)
- Process binds `0.0.0.0:$PORT`

## Checklist before first successful deploy

- [ ] Dockerfile parses (`MAIL_FROM_NAME` quoted)
- [ ] `package-lock.json` committed for `frontend/` and `backend/` (`npm ci`)
- [ ] Postgres linked → `DATABASE_URL` present
- [ ] Startup log shows `schema validation: OK` (no missing tables)
- [ ] Strong `JWT_SECRET` set
- [ ] `FRONTEND_URL` / `CORS_ORIGIN` / `OAUTH_CALLBACK_BASE` = public HTTPS URL
- [ ] Mail set via `RESEND_API_KEY` (recommended) or SMTP; `/api/health` shows `mail.verified: true`
- [ ] OAuth secrets set in Railway only
- [ ] OAuth provider consoles updated with Railway callbacks
- [ ] Storage: S3/R2 **or** volume at `/data`
- [ ] Push to GitHub → Railway auto-builds

## Local vs production

| Concern | Local | Railway |
|---------|-------|---------|
| Database | SQLite (`DATABASE_PROVIDER=sqlite`) | Postgres via `DATABASE_URL` |
| Frontend | Vite `:5173` proxy | Built into image, served by Express |
| Uploads | `./uploads` | S3/R2 or `/data/uploads` volume |
| Secrets | `backend/.env` (gitignored) | Railway Variables |
