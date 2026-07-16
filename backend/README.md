# Ninja Era Backend

REST API for the Ninja Era official website. Supports **SQLite** (default) and **PostgreSQL**, plus **local** or **S3-compatible** file storage — selected entirely through environment variables.

## Quick start

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

The API listens on **http://localhost:3001**.

Run frontend + backend together from the project root:

```bash
npm install
npm run dev
```

## Demo account

**Local development only.** After first start on an empty SQLite DB the database is seeded with a demo admin. Production never creates a hardcoded password — set `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` (≥12 chars) to bootstrap, or create an admin manually.

| Email | Password |
|-------|----------|
| `admin@ninjaera.com` | (local seed only — see `src/db/seed.ts`) |

## Security

See [`SECURITY.md`](./SECURITY.md) for auth, messaging ACL, upload hardening, restore rules, and the incident/rotation checklist.

Key production requirements:

- Strong `JWT_SECRET` (≥32 chars) — startup fails without it
- Finite `JWT_EXPIRES_IN` (defaults to `7d` in production)
- Never commit `SMTP_PASS` / OAuth secrets — set them only in the host dashboard
- Prefer private buckets + signed download URLs for gated files

## Switching databases

### SQLite (default — local development)

```env
DATABASE_PROVIDER=sqlite
DATABASE_PATH=./data/ninja-era.db
```

If `DATABASE_PROVIDER` is omitted, SQLite is used.

### PostgreSQL (Railway / production)

```env
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://user:pass@host:5432/ninja_era
# Optional:
# DATABASE_SSL=true
# DATABASE_SSL_REJECT_UNAUTHORIZED=false
# DATABASE_POOL_MAX=10
```

No code changes are required when switching providers. Schema migrations run automatically on startup for both engines.

### Cross-database migration (SQLite ↔ PostgreSQL)

1. In Admin → Database, create a **Portable** backup (`.json.gz`).
2. Point the app at the destination provider (`DATABASE_PROVIDER` + connection settings).
3. Start the app so migrations create an empty schema.
4. Restore the portable backup in Admin → Database → Restore.

Native backups (`.db` / `pg_dump`) only restore onto the **same** engine. Portable backups work across both.

## File storage

### Local (default — development)

```env
STORAGE_PROVIDER=local
UPLOAD_DIR=./uploads
# or omit UPLOAD_DIR to use <DATA_DIR>/uploads
```

Uploaded avatars, message media, voice notes, channel avatars, resources, and job files are written through the storage layer (not treated as app source).

### S3-compatible (Cloudflare R2 / AWS S3 / MinIO — production)

```env
STORAGE_PROVIDER=s3
S3_BUCKET=your-bucket
S3_REGION=auto
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=https://cdn.example.com
# S3_FORCE_PATH_STYLE=true
```

`R2_*` aliases are also accepted. Store only URLs/keys in the database — never binary blobs.

**Railway tip:** Prefer `STORAGE_PROVIDER=s3` (e.g. R2) so redeploys never wipe user uploads. If you keep `local`, mount a persistent volume at `/data` and set `UPLOAD_DIR=/data/uploads`.

## Backup & restore (Admin)

Super-admins can:

| Format | Use when |
|--------|----------|
| **Portable** (`.json.gz`) | Cross-provider migrate, disaster recovery, engine-agnostic |
| **Native** | Same-engine restore (SQLite file copy / `pg_dump`) |

Restore auto-detects format. A safety snapshot is taken before destructive restore.

## Railway deployment

1. Provision the web service from this repo (Dockerfile).
2. **Option A — SQLite + volume:** mount `/data`, keep `DATABASE_PROVIDER=sqlite`, `STORAGE_PROVIDER=local`.
3. **Option B — Postgres + R2 (recommended):**
   - Add Railway PostgreSQL → set `DATABASE_PROVIDER=postgres` and `DATABASE_URL`.
   - Configure Cloudflare R2 (or S3) → set `STORAGE_PROVIDER=s3` and `S3_*` vars.
4. Set `JWT_SECRET`, `CORS_ORIGIN`, `FRONTEND_URL`, and SMTP/OAuth secrets in the dashboard.
5. Deploy. `/api/health` reports `{ database, storage }`.

GitHub redeploys replace the container image only — they do **not** wipe Postgres or S3/R2 objects. With local SQLite/uploads, data survives only if the `/data` volume is mounted.

## Disaster recovery

1. Download a **portable** backup regularly from Admin → Database.
2. To rebuild: empty/new database → start app (migrations) → Restore portable file.
3. Re-point `STORAGE_PROVIDER` / CDN if media URLs used a public base URL that changed.

## API overview

| Area | Endpoints |
|------|-----------|
| **Auth** | `POST /api/auth/register` (pending verify), `verify-email`, `resend-verification`, `login`, `logout`, `forgot-password`, `reset-password`, `GET /me` |
| **Users** | `GET/PATCH /api/users/me`, avatar upload, password, settings, stats, achievements, inventory |
| **Messages** | conversations, send/edit/delete messages, media upload, reactions, mute, reports |
| **Notifications** | `GET /api/notifications`, mark read |
| **Contact** | `POST /api/contact` |
| **Newsletter** | `POST /api/newsletter/subscribe` |
| **Jobs** | `GET /api/jobs`, `POST /api/jobs/:id/apply` |
| **Content** | `GET /api/team`, `/api/resources`, `/api/characters`, `/api/health` |
| **Admin** | users, channels, resources, database console, portable/native backup & restore |

Authentication uses JWT Bearer tokens (`Authorization: Bearer <token>`).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `JWT_SECRET` | — | Secret for signing tokens |
| `JWT_EXPIRES_IN` | `never` | Token lifetime (`never` = stay signed in until logout / password change / disable) |
| `DATABASE_PROVIDER` | `sqlite` | `sqlite` or `postgres` |
| `DATABASE_PATH` | `./data/ninja-era.db` | SQLite file path |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `DATABASE_SSL` | auto | Force SSL for Postgres |
| `STORAGE_PROVIDER` | `local` | `local` or `s3` / `cloud` / `r2` |
| `UPLOAD_DIR` | `<DATA_DIR>/uploads` | Local upload root |
| `S3_BUCKET` / `S3_*` | — | S3-compatible object storage |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend origin |
| `FRONTEND_URL` | `http://localhost:5173` | Frontend origin for OAuth / email verify links |
| `OAUTH_CALLBACK_BASE` | `http://localhost:3001` | Public API base for OAuth callbacks |
| `SMTP_*` / `MAIL_FROM_*` | — | Gmail SMTP for verification / password reset |
| `GOOGLE_*` / `GITHUB_*` / `DISCORD_*` | — | OAuth credentials |

OAuth callback URL pattern: `{OAUTH_CALLBACK_BASE}/api/auth/oauth/{google|github|discord}/callback`

### Email verification / SMTP (Gmail)

Email/password signup **requires** working SMTP. Without `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS`, registration returns a friendly 503 and does not create a pending account.

1. Enable **2-Step Verification** on the Google account.
2. Create an **App Password**.
3. Set `SMTP_USER` / `SMTP_PASS` in `.env` or the host dashboard.

Do **not** use the normal Gmail password. Server logs never include App Passwords, verification codes, or tokens.

## Database internals

Versioned migrations live in `src/db/migrations/` and run on every boot via `schema_migrations`. Portable query helpers (`qGet` / `qAll` / `qRun`) work on both providers.

```bash
npm run db:seed   # re-seed only if database is empty
```

Local data defaults: `backend/data/` (SQLite + backups) and `UPLOAD_DIR` / `backend/data/uploads` for files.
