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

## Mail (email verification / password reset)

Railway frequently **cannot** reach Gmail SMTP (`ETIMEDOUT` / `ENETUNREACH` on IPv6). Prefer a transactional provider.

### Recommended: Resend (SMTP)

| Variable | Value |
|----------|-------|
| `SMTP_PROVIDER` | `resend` |
| `SMTP_USER` | `resend` |
| `SMTP_PASS` | Resend API key (dashboard only) |
| `MAIL_FROM_NAME` | `Ninja Era` |
| `MAIL_FROM_ADDRESS` | A sender on your **verified** Resend domain |

Other presets: `sendgrid`, `mailgun`, `ses`, `brevo`, `gmail`.

### Gmail (not reliable on Railway)

| Variable | Notes |
|----------|-------|
| `SMTP_PROVIDER` | `gmail` or omit |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | Gmail address |
| `SMTP_PASS` | **Google App Password** only |
| `SMTP_IP_FAMILY` | `4` (default) — forces IPv4 DNS/connect |

Startup logs print a clear `SMTP UNAVAILABLE` banner if verify fails. `/api/health` includes `mail.verified` (no secrets). Signup still **requires** working SMTP (returns 503 if unset/broken) — auth is not weakened.

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
- [ ] Strong `JWT_SECRET` set
- [ ] `FRONTEND_URL` / `CORS_ORIGIN` / `OAUTH_CALLBACK_BASE` = public HTTPS URL
- [ ] SMTP + OAuth secrets set in Railway only
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
