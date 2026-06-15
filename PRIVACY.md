# FaultMaven Copilot — Privacy Policy

**Effective date:** 2026-06-15
**Applies to:** FaultMaven Copilot browser extension (Chrome / Edge / Firefox)

FaultMaven Copilot ("the extension") is the browser interface for FaultMaven, an
AI-powered troubleshooting assistant. This policy explains exactly what data the
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
| **Page content** (visible text of the current tab) | Only when you explicitly click "capture page" for the active tab | Your configured FaultMaven backend | So the assistant can analyze logs, stack traces, and dashboard data you are looking at |
| **Messages, questions, and pasted text** | When you send them in the chat | Your configured FaultMaven backend | To answer your troubleshooting questions |
| **Files you upload** | When you attach a file | Your configured FaultMaven backend | To analyze logs/evidence you provide |
| **Authentication tokens** | During and after login | Stored locally; sent to your backend on each request to authenticate you | To keep you signed in securely |

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

- Authentication tokens and session identifiers (access token, session ID, PKCE
  verifiers, redirect URI)
- Your settings (the backend URL you configured)
- Limited cached case/conversation state for the case you are currently viewing
- First-run and backend-capability flags

This data stays on your device. It is cleared when you log out or uninstall the
extension. You can also clear it via your browser's extension settings.

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
  troubleshooting assistant. It is not used for advertising or for unrelated
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
| `sidePanel` | Render the assistant in the browser side panel |
| `activeTab` + `scripting` | Capture the current tab's content **only** when you initiate a capture |
| `tabs` | Detect completion of the OAuth login redirect and manage the login tab |
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
