#!/bin/bash

# Setup script for local development
echo "Setting up FaultMaven Copilot for local development..."

# Build-time knobs (VITE_*) live in .env.local. Endpoints are NOT among them:
# the API and Dashboard URLs are runtime settings (Welcome screen / Settings
# page), stored in browser.storage.local — see src/extension/host/endpoints.ts.
if [ -f .env.local ]; then
  echo "ℹ️  .env.local already exists; leaving it unchanged"
else
  cp .env.example .env.local
  echo "✅ Created .env.local from .env.example"
fi
echo ""
echo "🔧 Endpoints:"
echo "   - Default: FaultMaven Cloud (https://api.faultmaven.ai, https://app.faultmaven.ai)"
echo "   - Local:   choose \"Standalone (Self-Hosted)\" on the Welcome screen"
echo "              (http://localhost:8090, http://localhost:3333), or set them on the Settings page"
echo ""
echo "🚀 To start development:"
echo "   pnpm dev"
