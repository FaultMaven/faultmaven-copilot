# FaultMaven Copilot - Permission Justification

This document justifies the permissions requested in `manifest.json` for Chrome Web Store review.

## Permissions

### `storage`
Used to persist user preferences (e.g. configured backend endpoints) and essential session data (e.g. the active case ID and optimistic UI state) to `chrome.storage.local`. This is necessary to maintain extension state when the service worker is suspended and to recover state gracefully across browser restarts.

### `sidePanel`
Provides the core user interface of the extension. FaultMaven Copilot is designed as a persistent side panel companion that developers use alongside their main debugging tasks in adjacent browser tabs.

### `activeTab`
Grants temporary access to the currently active tab so the user can capture its content (URL, title, and visible page text) for analysis — only after the user explicitly clicks "Page Capture" in the side panel. The extension does not autonomously read tabs; it relies on explicit user intent to ingest a page into the troubleshooting context.

### `tabs`

Needed for two things, neither of which involves monitoring browsing:

1. **OAuth login flow** — detect when the sign-in redirect completes by reading the redirect URL on the login tab (`tabs.onUpdated`), then close that tab.
2. **Dashboard navigation** — open or focus the FaultMaven dashboard tab when the user follows an "open in Dashboard" link.

### `scripting`
Used to execute the page capture script (`scripting.executeScript`) on the active tab *only when explicitly requested by the user*. This allows the extension to extract DOM content (text, error messages, stack traces) to provide context to the AI copilot.

## Host Permissions

### `https://app.faultmaven.ai/*` & `https://api.faultmaven.ai/*`
The default backend endpoints for the FaultMaven Cloud service. The extension must communicate with the API to authenticate, load cases, submit messages, and interact with the copilot.

## Optional Host Permissions (Requested at Runtime)

`http://localhost/*`, `http://127.0.0.1/*`, `http://*/*`, `https://*/*` are declared as **optional** host permissions. They are **never granted at install time** — the install prompt only covers the two required `faultmaven.ai` domains above. Each broad pattern is requested **on demand, for one specific origin at a time**, via `chrome.permissions.request()`, and the browser shows the user a standard per-site prompt they can decline.

They cover two user-initiated scenarios:

1. **Custom self-hosted backend** — when the user configures an on-premise/LAN FaultMaven server in Settings, the extension requests host access for exactly that origin so it can reach the API.
2. **Page capture from the side panel** — when the user clicks "Page Capture", the extension requests host access for the active tab's origin so it can run the one-shot extraction script. `activeTab` alone is insufficient here because `activeTab` is granted only on a toolbar-icon click, not on a side-panel button click, so capture initiated from the side panel must request the origin explicitly.

Because the self-hosted backend and the captured page can be on any origin the user chooses, the patterns must be broad; they are not used to read or inject into sites without an explicit, per-site user action.

## Content Security Policy (CSP)
The `connect-src 'self' http: https:` directive is necessary because the extension communicates with the user-configured backend, which may be self-hosted on an arbitrary domain. We cannot hardcode all possible self-hosted domains in the manifest, so we rely on the CSP to allow the fetches, while relying on the dynamic host permission system (mentioned above) to satisfy the cross-origin fetch requirements.
