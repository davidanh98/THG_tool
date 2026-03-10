FROM node:20-slim

# Install system Chromium for Playwright (Debian Bookworm / node:20-slim)
# Note: libasound2 was renamed libasound2t64 in Debian Bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libasound2t64 \
    libxss1 \
    libgtk-3-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Tell Playwright to use system Chromium (no separate download needed)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install Node deps (cached layer — only rebuilds if package.json changes)
COPY package*.json ./
RUN npm ci --production --silent

# Copy application source
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/

# Ensure data & log dirs exist (volume-mounted in production)
RUN mkdir -p data logs

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/api/stats || exit 1

CMD ["node", "src/index.js"]
