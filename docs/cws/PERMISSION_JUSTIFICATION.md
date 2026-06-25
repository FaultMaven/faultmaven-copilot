# FaultMaven Copilot - Permission Justification

This document justifies the permissions requested in `manifest.json` for Chrome Web Store review.

## Permissions

### `storage`
Used to persist user preferences (e.g. configured backend endpoints) and essential session data (e.g. the active case ID and optimistic UI state) to `chrome.storage.local`. This is necessary to maintain extension state when the service worker is suspended and to recover state gracefully across browser restarts.

### `sidePanel`
Provides the core user interface of the extension. FaultMaven Copilot is designed as a persistent side panel companion that developers use alongside their main debugging tasks in adjacent browser tabs.

### `activeTab` & `tabs`
Required to extract the URL, title, and structure of the currently viewed webpage when the user explicitly clicks the "Page Capture" button in the side panel. The extension does not autonomously read tabs; it relies on explicit user intent to ingest a page into the troubleshooting context. `tabs` is additionally needed to listen for tab activation events so the extension knows which tab's content is available for capture.

### `scripting`
Used to execute the page capture script (`scripting.executeScript`) on the active tab *only when explicitly requested by the user*. This allows the extension to extract DOM content (text, error messages, stack traces) to provide context to the AI copilot.

## Host Permissions

### `https://app.faultmaven.ai/*` & `https://api.faultmaven.ai/*`
The default backend endpoints for the FaultMaven Cloud service. The extension must communicate with the API to authenticate, load cases, submit messages, and interact with the copilot.

## Optional Host Permissions (Requested at Runtime)

The extension allows users to configure a custom, self-hosted backend (e.g., an on-premise deployment). In this scenario, the extension requests host permissions dynamically via `chrome.permissions.request()` for the specific domain the user configured in the Options page. 

## Content Security Policy (CSP)
The `connect-src 'self' http: https:` directive is necessary because the extension communicates with the user-configured backend, which may be self-hosted on an arbitrary domain. We cannot hardcode all possible self-hosted domains in the manifest, so we rely on the CSP to allow the fetches, while relying on the dynamic host permission system (mentioned above) to satisfy the cross-origin fetch requirements.
