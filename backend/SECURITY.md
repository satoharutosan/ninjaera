# Security Architecture

This document describes the security controls implemented for Ninja Era Teams after the July 2026 hardening pass.

## Operator checklist (do this first)

1. **Rotate** any SMTP App Password that was ever committed or shared in chat/history.
2. Set secrets only in the host dashboard (Render / Railway / Vercel) — never in Git:
   - `JWT_SECRET` (≥32 random characters)
   - `SMTP_PASS`
   - OAuth client secrets
3. If the repo was pushed remotely with a leaked secret, scrub history (`git filter-repo` / BFG) and revoke the secret.
4. Production must set `NODE_ENV=production` and a strong `JWT_SECRET` (startup fails closed otherwise).
5. Prefer private object storage without a permanent public CDN for private resources.

## Auth & sessions

| Control | Behavior |
|---------|----------|
| JWT secret | Production refuses weak/missing `JWT_SECRET` |
| JWT expiry | Production defaults to `7d`; `never` is blocked in production |
| Logout | Calls `bumpTokenVersion` — existing JWTs invalidate immediately |
| Login rate limit | Per-IP + per-email sliding windows |
| Registration password | Min 8 chars + letter + number (`validateNewPassword`) |
| OAuth Google | Requires `email_verified === true` |
| OAuth account link | Password accounts are **not** silently linked by email |
| OAuth callback | One-time code in URL → `POST /auth/oauth/exchange` (no JWT in URL) |
| Seed | Production never creates a hardcoded admin password |

**Follow-up (Phase F):** migrate Bearer tokens from JS-readable storage to HttpOnly Secure SameSite cookies + CSRF.

## Messaging ACL

- Central `assertCanAccessConversation` (participant **and** channel visibility) on send / gif / media / react / read / mute / typing / calls.
- `replyTo` must reference a message in the **same** conversation.
- DM create (`POST /conversations`, `POST /dm-conversations`) requires existing contact / accepted request.
- `blocks` enforced on DM search/request/open, messaging, and calls.
- Public→private channel demotion prunes ineligible participants and force-leaves sockets.
- Socket.IO rate limits on `typing`, `call:invite`, `call:signal` (+ payload size cap).

## Uploads & storage

- Shared `validateUpload`: MIME ∧ extension ∧ magic bytes where applicable.
- Channel avatars require MIME **and** extension.
- Local `deleteObject` is path-bounded under the storage root.
- `/uploads` serves with `X-Content-Type-Options: nosniff`; HTML/SVG forced to attachment.
- Private resources / game builds use **signed URLs** (no permanent public CDN fallback).
- Job application files are not anonymously readable via `/uploads`.

## Admin & restore

- DB console hides `password_reset_tokens`, `pending_registrations`, and masks `*_hash` / privilege columns.
- Restore accepts **portable** (`.json` / `.json.gz`) or native SQLite only — **no arbitrary `psql`**.
- Gzip expansion capped (256 MiB).
- Email rewrite and team-member flag changes require Super Admin.

## Platform

- `helmet` (CSP in production, HSTS, frame denial, Referrer-Policy, Permissions-Policy).
- Explicit CORS allowlist; Socket.IO shares the same origins.
- `trust proxy` enabled in production (override with `TRUST_PROXY=0` if needed).
- Rate limits on login, register, verify, reset, contact, newsletter, reports, uploads.

## Incident / rotation

1. Bump `JWT_SECRET` → all sessions die (users must re-login).
2. Rotate SMTP App Password in Google + host env.
3. Rotate OAuth client secrets and update callback URLs.
4. Review Admin → Activity logs for `login_failed` / `login_denied` spikes.
5. If a backup was restored from an untrusted source, treat credentials as compromised.

## Dual-provider notes

All hardening preserves SQLite + PostgreSQL via `qGet` / `qAll` / `qRun` and portable backups. Prefer portable backups for cross-engine restore.
