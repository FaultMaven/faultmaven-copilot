# Chrome Web Store Submission Guide

Everything needed to fill in the Chrome Web Store Developer Dashboard listing for
**FaultMaven Copilot**. Copy each field from here into the dashboard.

> Build the package with `pnpm zip` (produces `.output/faultmaven-copilot-<version>-chrome.zip`).
> Production builds target FaultMaven Cloud by default (no env wiring required).

---

## 1. Store listing

**Name:** FaultMaven Copilot

**Summary** (≤132 chars):
> AI troubleshooting copilot in your browser side panel — analyze logs, traces, and dashboards in flow, grounded in your runbooks.

**Category:** Developer Tools

**Language:** English

**Detailed description:**

```
FaultMaven Copilot puts an AI troubleshooting assistant in your browser side
panel, right next to the tools you already use — AWS Console, Datadog, Grafana,
Kubernetes dashboards, or your own apps.

Instead of copy-pasting logs into a separate chat, capture what you're looking at
and ask. FaultMaven correlates the page content with your runbooks, past fixes,
and documentation to give you grounded, contextual answers — not generic guesses.

WHAT IT DOES
• Capture-in-context: pull the logs, stack traces, and data on your active tab
  into the assistant with one click — only when you ask it to.
• In-flow chat: investigate an incident without leaving your dashboard.
• Knowledge-grounded answers: responses reference your own runbooks and docs.
• Case tracking: investigations persist as cases you can revisit.
• Runbooks from resolutions: turn a solved case into a reusable runbook.

HOW IT WORKS
The extension connects to a FaultMaven backend — either FaultMaven Cloud or a
FaultMaven server you self-host. You sign in, and your troubleshooting data is
sent only to the backend you choose. The extension has no analytics or trackers.

REQUIRES A FAULTMAVEN BACKEND
This extension is a client for FaultMaven. You need either a FaultMaven Cloud
account or a self-hosted FaultMaven deployment. Learn more at https://faultmaven.ai.

PRIVACY
Page capture is never automatic — it only happens when you click capture, on the
tab that is active at that moment. The extension does not monitor your browsing.
See the privacy policy for full detail.
```

**Privacy policy URL:** `https://faultmaven.ai/privacy`
*(Publish `PRIVACY.md` at this URL before submitting. A public GitHub-hosted page
is also acceptable if a website page is not yet available.)*

---

## 2. Single purpose

> FaultMaven Copilot provides an AI troubleshooting assistant in a browser side
> panel that analyzes content from the user's active tab (on demand) and the
> user's typed input, by communicating with the user's chosen FaultMaven backend.

---

## 3. Permission justifications

Paste these into the matching "justification" fields. They reflect the shipped
manifest exactly.

| Permission | Justification |
|------------|---------------|
| `storage` | Stores authentication tokens, session identifiers, and the user's backend URL setting locally so the user stays signed in and configured between sessions. |
| `sidePanel` | The entire user interface is rendered in the browser side panel. |
| `activeTab` | Grants temporary access to the currently active tab so the user can capture its content for analysis, only after the user initiates a capture. |
| `scripting` | Injects a one-shot text-extraction function into the active tab — only when the user clicks capture — to read the visible page content. No persistent or all-sites content script is used. |
| `tabs` | Detects when the OAuth login redirect completes (by reading the redirect URL on the login tab) and closes the login tab afterward. Also used to focus/open the FaultMaven dashboard tab. |

**Host permissions**

| Host pattern | Type | Justification |
|--------------|------|---------------|
| `https://app.faultmaven.ai/*`, `https://api.faultmaven.ai/*` | required | The FaultMaven Cloud dashboard and API the extension authenticates against and sends troubleshooting data to. |
| `http://localhost/*`, `http://127.0.0.1/*` | optional | Lets users connect the extension to a self-hosted FaultMaven instance running locally. |
| `http://*/*`, `https://*/*` | optional | Requested **on demand, per individual site**, only the first time the user captures content from that site, or to connect to a self-hosted FaultMaven server on a custom domain. Not requested at install time. |

**Remote code:** No. The extension executes no remote/hosted code; all scripts
are bundled. The injected capture function is defined inline in the extension
bundle.

---

## 4. Data use disclosures (Privacy practices tab)

Declare the following data types as **collected** and **transferred to the
user's chosen backend** (not sold, not used for unrelated purposes):

- **Website content** — page text the user captures, plus typed messages and
  uploaded files. Used to provide the troubleshooting feature.
- **Authentication information** — tokens/session, stored locally and sent to
  the backend to authenticate the user.

Certify all three "limited use" disclosures:
- ✅ Data is used only to provide the single purpose described above.
- ✅ Data is **not** sold to third parties.
- ✅ Data is **not** used or transferred for purposes unrelated to the item's
  single purpose (no advertising, no creditworthiness).

There are no third-party analytics or advertising SDKs in the extension.

---

## 5. Notes to reviewer (REQUIRED — extension is non-functional without a backend)

```
FaultMaven Copilot is a client for the FaultMaven troubleshooting backend and
requires an account to test. Please use these steps:

1. Click the extension icon to open the side panel.
2. It defaults to FaultMaven Cloud (https://app.faultmaven.ai). Sign in with:
   - Email: <REVIEWER TEST ACCOUNT EMAIL>
   - Password: <REVIEWER TEST ACCOUNT PASSWORD>
3. Start a new case and type a troubleshooting question, e.g.
   "Why is my pod crash-looping?"
4. To test page capture: open any page with logs/text, click the capture button
   in the input bar, approve the one-time site permission prompt, and send.

Page capture is user-initiated only; the extension does not read pages in the
background. Optional host permissions are requested per-site at capture time.
```

> ⚠️ **Action item:** create a dedicated reviewer test account on FaultMaven Cloud
> and fill in the credentials above before submitting.

---

## 6. Required listing assets (TODO — must be produced)

| Asset | Spec | Status |
|-------|------|--------|
| Store icon | 128×128 PNG | ✅ available (`public/icon/px128-square-dark.png`) |
| Screenshots | 1280×800 or 640×400 PNG/JPEG, 1–5 images | ❌ to capture |
| Small promo tile | 440×280 PNG (needed for any featuring) | ❌ to create |
| Marquee promo tile | 1400×560 PNG (optional) | ❌ optional |

See **`docs/cws/SCREENSHOTS.md`** for the step-by-step capture checklist (which
screen, what to show, exact dimensions, and a pre-upload quality gate).

---

## 7. Pre-submission checklist

- [ ] `pnpm compile` clean, `pnpm test` green
- [ ] `pnpm zip` produces a fresh package at the current version
- [ ] Verify install warning no longer says "read and change all your data on all
      websites" (it should not, now that the all-sites content script is removed)
- [ ] Privacy policy published at its public URL and entered in the listing
- [ ] Reviewer test account created and credentials added to §5
- [ ] Screenshots + promo tile produced and uploaded
- [ ] Developer account verified ($5 one-time registration fee paid)
- [ ] Bump `version` in `package.json` + `wxt.config.ts` if resubmitting
