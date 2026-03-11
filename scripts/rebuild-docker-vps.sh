#!/bin/bash
# Run this script on the VPS to force rebuild the Docker image with playwright:v1.58.2

cd /root/THG_tool

echo "=== Step 1: Pull latest code ==="
git fetch origin main
git reset --hard origin/main

echo "=== Step 2: Force pull new Playwright base image ==="
docker pull mcr.microsoft.com/playwright:v1.58.2-noble

echo "=== Step 3: Build new image (no cache) ==="
DOCKER_IMAGE="" docker compose build --no-cache app

echo "=== Step 4: Restart container with new image ==="
docker compose up -d --force-recreate

echo "=== Step 5: Wait for container to start ==="
sleep 15

echo "=== Step 6: Sync groups from production ==="
docker exec thg-lead-gen node scripts/sync-groups.js || echo "sync-groups failed, continuing..."

echo "=== Step 7: Verify Playwright works ==="
docker exec thg-lead-gen node -e "const {chromium}=require('playwright');chromium.executablePath().then(p=>console.log('Chromium path:',p)).catch(e=>console.error('Error:',e.message))"

echo "=== Done! Check logs: docker logs thg-lead-gen --tail 50 ==="
