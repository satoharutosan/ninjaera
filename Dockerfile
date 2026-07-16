# Multi-stage build suitable for Railway / Render.
# Defaults: SQLite + local uploads on a mounted volume at /data.
# Production alternatives (set at runtime):
#   DATABASE_PROVIDER=postgres + DATABASE_URL
#   STORAGE_PROVIDER=s3 + S3_* / R2_* credentials (persistent across deploys)

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npx tsc

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_PROVIDER=sqlite
ENV DATABASE_PATH=/data/ninja-era.db
ENV STORAGE_PROVIDER=local
ENV UPLOAD_DIR=/data/uploads
ENV DATA_DIR=/data
ENV MAIL_FROM_NAME=Ninja Era
ENV MAIL_FROM_ADDRESS=softfuture28@gmail.com
ENV SMTP_HOST=smtp.gmail.com
ENV SMTP_PORT=587
# SMTP_USER / SMTP_PASS must be provided at runtime (Google App Password)
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=backend-build /app/backend/assets ./assets
COPY --from=frontend-build /app/frontend/dist ./public

# Serve the SPA from Express when SPA_DIR is set
ENV SPA_DIR=/app/backend/public

EXPOSE 3001
CMD ["node", "dist/index.js"]
