# Multi-stage production image for Railway (and compatible hosts).
#
# Root-cause fix for prior parse error:
#   ENV MAIL_FROM_NAME=Ninja Era
# Docker ENV values with spaces MUST be quoted, otherwise the parser treats
# "Era" as a second name=value token → Syntax error - can't find = in "Era".
#
# Runtime overrides (Railway Variables):
#   DATABASE_PROVIDER=postgres + DATABASE_URL=...
#   JWT_SECRET, CORS_ORIGIN, FRONTEND_URL, OAUTH_CALLBACK_BASE
#   SMTP_* / OAuth secrets — never bake secrets into this file
#   STORAGE_PROVIDER=s3 + S3_* for durable uploads (recommended on Railway)

# ── Frontend (Vite) ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Backend compile ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS backend-build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npx tsc

# Production node_modules (native modules built for linux)
FROM node:22-bookworm-slim AS backend-prod-deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app/backend

ENV NODE_ENV=production
# Railway injects PORT at runtime; 3001 is a local/fallback default only.
ENV PORT=3001
# Prefer Postgres on Railway via DATABASE_URL; sqlite remains for local/volume demos.
ENV DATABASE_PROVIDER=sqlite
ENV DATABASE_PATH=/data/ninja-era.db
ENV STORAGE_PROVIDER=local
ENV UPLOAD_DIR=/data/uploads
ENV DATA_DIR=/data
ENV MAIL_FROM_NAME="Ninja Era"
ENV SPA_DIR=/app/backend/public

# Railway volumes mount as root; stay root so /data is writable when using local storage.
# Prefer STORAGE_PROVIDER=s3 in production so uploads survive without a volume.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data/uploads /app/backend/public

COPY --from=backend-prod-deps /app/backend/node_modules ./node_modules
COPY --from=backend-prod-deps /app/backend/package.json ./package.json
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/assets ./assets
COPY --from=frontend-build /app/frontend/dist ./public

EXPOSE 3001
CMD ["node", "dist/index.js"]
