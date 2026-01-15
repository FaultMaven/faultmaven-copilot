## Description
<!-- Provide a clear and concise description of what this PR does -->

## Screenshots / Demos (Required for UI Changes)
| Extension Popup | Content Script (Overlay) |
| :---: | :---: |
| <img src="" width="250" /> | <img src="" width="300" /> |

## Type of Change
- [ ] 🐛 Bug fix
- [ ] ✨ New feature
- [ ] 🔒 **Security / Permissions Update** (Modified `manifest.json`)
- [ ] 🎨 UI/UX improvement

## 🧩 Extension Compatibility Check
- [ ] **Chrome:** Verified in a standard Chrome profile.
- [ ] **Firefox:** Verified (extensions often break here due to distinct API standards).
- [ ] **Arc / Edge:** (Optional) Verified in other Chromium browsers.

## 🛡️ Security & Manifest Checklist
- [ ] **Permissions:** I have *not* added unnecessary permissions to `wxt.config.ts` / `manifest.json`.
- [ ] **Data Privacy:** This PR does not send new user data (URLs, DOM content) to the backend without consent.
- [ ] **Logs:** Removed all `console.log` statements (crucial for performance in content scripts).
- [ ] **Localhost:** I have ensured no hardcoded `localhost:8000` URLs are left in the production build.

## Standard Checklist
- [ ] I have performed a self-review of my code.
- [ ] My changes generate no new console errors in the background service worker.

## CI/CD Policy Checklist

- [ ] This PR does **not** introduce direct Kubernetes deploy logic in this service repo (no `kubectl`, no `kustomize`, no `runs-on: [self-hosted, ...]`).
- [ ] Deployment changes (image/config) are handled via `faultmaven-enterprise-infra` promotion + overlays.
