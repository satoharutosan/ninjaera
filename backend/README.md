# Ninja Era Backend

REST API for the Ninja Era official website, backed by SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3).

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

After first start the database is seeded automatically:

| Email | Password |
|-------|----------|
| `ninja@example.com` | `password123` |

## API overview

| Area | Endpoints |
|------|-----------|
| **Auth** | `POST /api/auth/register`, `login`, `logout`, `forgot-password`, `reset-password`, `GET /me` |
| **Users** | `GET/PATCH /api/users/me`, avatar upload, password, settings, stats, achievements, inventory |
| **Messages** | conversations, send/edit/delete messages, media upload, reactions, mute, reports |
| **Notifications** | `GET /api/notifications`, mark read |
| **Contact** | `POST /api/contact` |
| **Newsletter** | `POST /api/newsletter/subscribe` |
| **Jobs** | `GET /api/jobs`, `POST /api/jobs/:id/apply` |
| **Content** | `GET /api/team`, `/api/resources`, `/api/characters`, `/api/health` |

Authentication uses JWT Bearer tokens (`Authorization: Bearer <token>`).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `JWT_SECRET` | — | Secret for signing tokens |
| `DATABASE_PATH` | `./data/ninja-era.db` | SQLite file path |
| `UPLOAD_DIR` | `./uploads` | Uploaded files directory |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend origin |

## Database

SQLite schema is created on startup. Seed data includes demo user, NPC contacts, channels, notifications, jobs, and team members.

```bash
npm run db:seed   # re-seed only if database is empty
```

Data files are stored in `backend/data/` and uploads in `backend/uploads/`.
