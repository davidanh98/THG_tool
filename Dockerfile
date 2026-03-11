FROM mcr.microsoft.com/playwright:v1.58.2-noble

# noble = Ubuntu 24.04 — all Chromium deps already installed
# Playwright's Chromium is at /ms-playwright/chromium-*/chrome-linux/chrome

WORKDIR /app

# ── Layer 1: Dependencies (cached unless package*.json changes) ──
COPY package*.json ./
RUN npm ci --production --silent && npm cache clean --force

# ── Layer 2: Application source ──
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/

# Ensure data & log dirs exist (volume-mounted in production)
RUN mkdir -p data logs

# Use system Chromium bundled by Playwright base image
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production

EXPOSE 3000

# Unified health check — uses /health endpoint (lightweight, no auth)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -sf http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
