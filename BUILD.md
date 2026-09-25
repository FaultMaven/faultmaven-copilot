# Building FaultMaven Copilot

## Build Process

There is **one build** that works for both deployment environments:

- **Cloud** - FaultMaven SaaS (`https://app.faultmaven.ai`)
- **Local** - Self-hosted (`http://localhost:3333`)

Users choose their deployment type via the Welcome screen on first run.

## Build Command

```bash
pnpm build
```

This creates a single build that:

- Defaults to Cloud deployment (safe for Chrome Web Store distribution)
- Allows users to choose Standalone (self-hosted) deployment via Welcome screen
- Stores user choice in browser extension storage

## How URL Configuration Works

### Priority Order (Highest to Lowest)

1. **Stored endpoints** - `apiBaseUrl` and `dashboardUrl` in `browser.storage.local`,
   written by the Welcome screen or the Settings page. The two are configured
   independently; neither is derived from the other.
   - FaultMaven Cloud: `https://api.faultmaven.ai` / `https://app.faultmaven.ai`
   - Standalone (Self-Hosted): `http://localhost:8090` / `http://localhost:3333`

2. **Legacy key migration** - an install that predates explicit configuration
   has only `apiEndpoint` (which held the Dashboard URL). It is migrated once:
   it seeds `dashboardUrl`, and `apiBaseUrl` is derived with the old rule
   (`:3333` → `:8090`, `app.` → `api.`).

3. **Cloud defaults** - when nothing is stored.

No build-time variable sets an endpoint; see `src/extension/host/endpoints.ts`
and [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

### For Chrome Web Store Users

1. Install extension from Chrome Web Store
2. First run shows Welcome screen
3. Choose deployment type:
   - **FaultMaven Cloud (SaaS)** - Sets the Cloud API and Dashboard URLs
   - **Standalone (Self-Hosted)** - Sets `http://localhost:8090` and `http://localhost:3333`
4. Extension stores choice, never uses fallback

### For Local Development

1. Build extension: `pnpm build`
2. Load unpacked in Chrome from `.output/chrome-mv3`
3. Welcome screen defaults to production (safe default)
4. Choose "Standalone (Self-Hosted)" to configure localhost
5. Change either URL afterwards on the Settings page

## Testing Builds

### Test Local Build

```bash
# Build
pnpm build

# Load unpacked extension from .output/chrome-mv3
# Choose "Standalone (Self-Hosted)" in Welcome screen
# Should connect to http://localhost:3333 and http://localhost:8090
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
