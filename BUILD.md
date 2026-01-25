# Building FaultMaven Copilot

## Build Process

There is **one build** that works for both deployment environments:

- **Cloud** - FaultMaven SaaS (`https://app.faultmaven.ai`)
- **Local** - Self-hosted (`http://127.0.0.1:3333`)

Users choose their deployment type via the Welcome screen on first run.

## Build Command

```bash
pnpm build
```

This creates a single build that:

- Defaults to Cloud deployment (safe for Chrome Web Store distribution)
- Allows users to choose Local deployment via Welcome screen
- Stores user choice in browser extension storage

## How URL Configuration Works

### Priority Order (Highest to Lowest)

1. **User Choice via Welcome Screen** - Stored in `browser.storage.local.apiEndpoint`
   - FaultMaven Cloud: `https://app.faultmaven.ai`
   - Open Source Local: `http://127.0.0.1:3333`

2. **Build-Time Environment Variable** - `VITE_API_URL` from `.env.*` files
   - `.env.development`: `http://127.0.0.1:8090`
   - `.env.production`: `https://api.faultmaven.ai`

3. **Hardcoded Fallback** - Production defaults in code
   - Dashboard: `https://app.faultmaven.ai`
   - API: `https://api.faultmaven.ai`

### For Chrome Web Store Users

1. Install extension from Chrome Web Store
2. First run shows Welcome screen
3. Choose deployment type:
   - **FaultMaven Cloud (SaaS)** - Sets `https://app.faultmaven.ai`
   - **Open Source (Local)** - Sets `http://127.0.0.1:3333`
4. Extension stores choice, never uses fallback

### For Local Development

1. Build extension: `pnpm build`
2. Load unpacked in Chrome from `.output/chrome-mv3`
3. Welcome screen defaults to production (safe default)
4. Choose "Open Source (Local)" to configure localhost
5. Extension derives API URL from Dashboard URL:
   - `http://127.0.0.1:3333` → `http://127.0.0.1:8090`

## Testing Builds

### Test Local Build

```bash
# Build
pnpm build

# Load unpacked extension from .output/chrome-mv3
# Choose "Open Source (Local)" in Welcome screen
# Should connect to http://127.0.0.1:3333 and http://127.0.0.1:8090
```

### Test Production Build

```bash
# Build
NODE_ENV=production pnpm build

# Load unpacked extension from .output/chrome-mv3
# Choose "FaultMaven Cloud (SaaS)" in Welcome screen
# Should connect to https://app.faultmaven.ai and https://api.faultmaven.ai
```

## Troubleshooting

### Extension Connects to Wrong URL

1. Clear extension storage:

   ```javascript
   // In extension's background service worker console (chrome://extensions/)
   chrome.storage.local.clear().then(() => console.log('Storage cleared'));
   ```

2. Reload extension
3. Complete Welcome screen again

### Want to Change Deployment Type

1. Open extension Settings page
2. Update "Dashboard URL" field
3. Save and reload extension
