# Multi-stage build suitable for Railway / Render free-tier dynos.
# Persist SQLite + uploads via a mounted volume at /data.

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
ENV DATABASE_PATH=/data/ninja-era.db
ENV UPLOAD_DIR=/data/uploads

COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm ci --omit=dev
COPY --from=backend-build /app/backend/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./public

# Serve the SPA from Express when SPA_DIR is set
ENV SPA_DIR=/app/backend/public

EXPOSE 3001
CMD ["node", "dist/index.js"]
