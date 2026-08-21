# FaultMaven Copilot — Privacy Policy

**Effective date:** 2026-06-15
**Applies to:** FaultMaven Copilot browser extension (Chrome / Edge / Firefox)

FaultMaven Copilot ("the extension") is the browser interface for FaultMaven, an
AI-powered troubleshooting copilot. This policy explains exactly what data the
extension accesses, where that data goes, and what it does **not** do.

We designed the extension to be a thin, transparent client: it does not have its
own servers, analytics, or trackers. It sends data only to the **FaultMaven
backend you choose to connect to** — either FaultMaven Cloud
(`https://api.faultmaven.ai`) or a self-hosted FaultMaven server that you or your
organization operates.

---

## 1. Who controls your data

The data controller depends on which backend you connect to:

- **FaultMaven Cloud** (`app.faultmaven.ai` / `api.faultmaven.ai`) — operated by
  the FaultMaven team. Data you submit is processed on FaultMaven Cloud to
  provide the troubleshooting service.
- **Self-hosted FaultMaven** — operated entirely by you or your organization on
  infrastructure you control. The extension sends data only to the server URL
  you configure in Settings. The FaultMaven team does not receive that data.

The extension defaults to FaultMaven Cloud. You can point it at a self-hosted
server at any time from the Settings screen.

---

## 2. What the extension accesses and transmits

The extension only transmits data to your configured FaultMaven backend, and
only as a result of actions you take. Specifically:

| Data | When | Where it goes | Why |
|------|------|---------------|-----|
| **Page content** (visible text of the current tab, including values you have typed into ordinary form fields — but never passwords, hidden fields, or one-time-code / payment-card fields) | Only when you explicitly click "capture page" for the active tab | Your configured FaultMaven backend | So the copilot can analyze logs, stack traces, and dashboard data you are looking at |
| **The captured page's URL** (with the `#fragment` removed, since fragments can carry tokens) | With each page capture you submit | Your configured FaultMaven backend | So captured evidence is traceable to its source page |
| **Messages, questions, and pasted text** | When you send them in the chat | Your configured FaultMaven backend | To answer your troubleshooting questions |
| **Files you upload** | When you attach a file | Your configured FaultMaven backend | To analyze the logs and other data you provide |
| **Authentication tokens** | During and after login | Stored locally; sent to your backend on each request to authenticate you | To keep you signed in securely |
| **A random client identifier** (a UUID generated locally; contains no personal information) | When a working session is created | Your configured FaultMaven backend | To associate your session with this browser install and deduplicate requests |

**Page capture is never automatic.** The extension only reads page content when
you initiate a capture, and only from the tab that is active at that moment. It
does not run a background script on every website, and it does not silently read
or monitor the pages you browse.

For sites other than your FaultMaven backend, the extension requests host access
**at the moment you first capture that site**, and your browser shows a standard
permission prompt that you can decline.

---

## 3. What is stored on your device

The extension stores the following in your browser's local extension storage
(`chrome.storage.local`) so the app can function:

- Authentication tokens and session identifiers (access token, refresh token,
  session ID, PKCE verifiers, redirect URI)
- Your user profile as returned by your backend (email, display name, roles),
  used to show who is signed in
- Your settings (the backend URL you configured)
- Cached conversation state: the case you are viewing plus a bounded number of
  recently viewed cases (each capped to its most recent messages), along with
  case titles, pinned-case IDs, and related bookkeeping
- A randomly generated client identifier and data-owner scope ID
- First-run, UI, and backend-capability flags

This data stays on your device. Logging out clears your authentication tokens,
profile, and cached conversation data. A few non-identifying items survive
logout (the random client identifier, pinned-case IDs, your configured backend
URL, and first-run/capability flags) so your settings are intact when you sign
back in; signing in as a *different* user purges the previous user's data.
Uninstalling the extension removes everything, and you can also clear the data
via your browser's extension settings.

---

## 4. What the extension does NOT do

- **No third-party analytics or trackers.** The extension contains no Google
  Analytics, advertising SDKs, session-replay, or other telemetry.
- **No data selling or sharing.** Your data is not sold or shared with third
  parties. It is sent only to the FaultMaven backend you connect to.
- **No browsing surveillance.** The extension does not log your browsing
  history, monitor tabs in the background, or capture pages you have not asked
  it to capture.
- **No use beyond the feature.** Data you submit is used solely to provide the
  troubleshooting copilot. It is not used for advertising or for unrelated
  purposes, and it is not used to train models except as separately disclosed
  and consented to by your FaultMaven backend operator.

---

## 5. Sensitive data and redaction

Troubleshooting data (logs, traces) can contain sensitive values. The FaultMaven
backend applies server-side PII redaction (for example, emails, secrets, and
credentials) before storing and processing content. When using a self-hosted
backend, redaction and retention are governed by your own deployment's
configuration and policies.

You remain responsible for the content you choose to capture and submit. Avoid
submitting data you are not authorized to share.

---

## 6. Permissions and why they are needed

| Permission | Purpose |
|------------|---------|
| `storage` | Store auth tokens, session, and settings locally |
| `sidePanel` | Render the copilot in the browser side panel |
| `scripting` | Inject the page-content extractor **only** when you initiate a capture, and register the sign-in bridge on your configured Dashboard origin only |
| `tabs` | Read the active tab's URL when you capture a page, and find or open your FaultMaven Dashboard tab when you click a Dashboard link |
| `identity` | Open the browser-managed sign-in window for OAuth login (`launchWebAuthFlow`). The extension never reads your browser profile identity |
| Host access to your FaultMaven backend | Communicate with the API you authenticate against |
| Optional host access to other sites | Granted on demand, per site, the first time you capture that site |

---

## 7. Data retention

- **Local (device):** retained until logout or uninstall, as described in §3.
- **Backend:** case data, conversations, and reports are retained by your
  FaultMaven backend according to that backend's retention policy. For
  FaultMaven Cloud, see the FaultMaven Cloud terms. For self-hosted, retention
  is controlled by your organization.

---

## 8. Children

FaultMaven Copilot is a professional engineering tool and is not directed to
children under 13.

---

## 9. Changes to this policy

We may update this policy as the extension evolves. Material changes will be
reflected by updating the effective date above and publishing the revised policy
at its public URL.

---

## 10. Contact

Questions about this policy or your data:

- **Issues:** https://github.com/FaultMaven/faultmaven-copilot/issues
- **Discussions:** https://github.com/FaultMaven/faultmaven/discussions

---

*This document is the canonical privacy policy for the FaultMaven Copilot
extension. It must be published at a public URL (for example,
`https://faultmaven.ai/privacy`) and that URL entered in the Chrome Web Store
listing's "Privacy policy" field.*
