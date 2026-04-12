# ── Build stage ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests first so Docker caches this layer unless deps change
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# ── Runtime stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Run as non-root user (Cloud Run security best practice)
RUN addgroup -S tubeintel && adduser -S tubeintel -G tubeintel

# Copy deps from build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# Remove local dev files that shouldn't be in the image
RUN rm -f .env db.json

# Cloud Run injects PORT=8080 — app already reads process.env.PORT
EXPOSE 8080

USER tubeintel

CMD ["node", "server.js"]
