# --- STAGE 1: The Fast Builder ---
FROM node:20-slim AS builder
WORKDIR /app

# Cài đặt pnpm toàn cục
RUN npm install -g pnpm

# Chỉ copy file lock để tận dụng cache
COPY pnpm-lock.yaml package.json ./

# Cấu hình pnpm hoisted mode (tránh symlink gãy khi COPY giữa stages)
RUN pnpm config set node-linker hoisted && \
    pnpm install --frozen-lockfile --prod

# --- STAGE 2: Slim Runner (API & AI Worker — ~150MB) ---
FROM node:20-slim AS runner-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN mkdir -p data logs
EXPOSE 3000

# --- STAGE 3: Heavy Runner (Scraper — Playwright + Chromium) ---
FROM mcr.microsoft.com/playwright:v1.48.0-noble AS runner-heavy
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV NODE_ENV=production
RUN mkdir -p data logs
