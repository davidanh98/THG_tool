# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright/node:20-jammy AS deps
# Uses Microsoft's official Playwright+Node image — Chromium already installed!
# No need to run `npx playwright install` ever again.

WORKDIR /app
COPY package*.json ./
RUN npm ci --production --silent

# ─── Stage 2: Production image ────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright/node:20-jammy AS runner

WORKDIR /app

# Copy node_modules from deps stage (layered for cache efficiency)
COPY --from=deps /app/node_modules ./node_modules

# Copy app source
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/
COPY ecosystem.config.js ./
COPY nginx/ ./nginx/

# Create data & logs directories
RUN mkdir -p data logs

# Non-root user for security
RUN groupadd -r thg && useradd -r -g thg thg \
    && chown -R thg:thg /app
USER thg

EXPOSE 3000

# Health check — nginx uses this to determine if container is healthy
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/api/stats || exit 1

CMD ["node", "src/index.js"]
