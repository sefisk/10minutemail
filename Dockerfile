# ============================================================
# Multi-stage Dockerfile for 10MinuteMail API
# ============================================================

# Stage 1: Install dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: Production image
FROM node:20-alpine AS production
LABEL maintainer="10minutemail"
LABEL description="Temporary email access API service"

# Security: run as non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY package.json ./
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY api/ ./api/
COPY pkg/ ./pkg/
COPY config/ ./config/
COPY db/ ./db/
COPY scripts/ ./scripts/

# Set ownership
RUN chown -R appuser:appgroup /app

USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start server
CMD ["node", "cmd/server.js"]
