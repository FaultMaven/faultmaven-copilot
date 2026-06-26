# Chrome Web Store Screenshots — Capture Checklist

The store listing needs **1–5 screenshots**. Chrome Web Store accepts **1280×800**
or **640×400** (PNG or JPEG). Use **1280×800** — it looks best on the listing.
Save the final files into this directory (`docs/cws/screenshots/`).

## One-time setup

1. Build and load the **production** extension (not the dev build, so no
   `localhost:3000` dev banner / HMR artifacts appear):
   ```bash
   pnpm build           # outputs .output/chrome-mv3/
   ```
   Load `.output/chrome-mv3/` as an unpacked extension (chrome://extensions →
   Developer mode → Load unpacked).
2. Sign in to a FaultMaven backend with **realistic, non-sensitive** demo data
   (Cloud or a seeded self-hosted instance). Avoid real customer logs, internal
   hostnames, tokens, or emails — reviewers and the public will see these.
3. Set the side panel to a clean width and capture at a 1280×800 viewport
   (resize the window / use the browser's device-toolbar or a screenshot tool so
   the exported image is exactly 1280×800).

## The shots (in listing order)

| # | Screen | What to show | Notes |
|---|--------|--------------|-------|
| 1 | **Active investigation** | Side panel open with a real-looking troubleshooting conversation — a question + a grounded answer, ideally citing a runbook/source. | Lead image; make it the most compelling. |
| 2 | **Page capture in action** | A page with logs/stack traces in the main area + the side panel showing the captured context (or the capture button / one-time permission prompt). | Demonstrates the core "capture-in-context" value. |
| 3 | **Knowledge-grounded answer** | An answer that references knowledge-base sources / runbooks. | Reinforces "not generic guesses". |
| 4 | **Settings / backend config** | The Options page showing the Cloud vs self-hosted backend configuration. | Supports the self-hosted + permission story reviewers will check. |
| 5 | **Welcome / sign-in** *(optional)* | The first-run Cloud vs Standalone choice or the login screen. | Optional 5th; drop if 1–4 tell the story. |

## Quality checklist before upload

- [ ] Exactly 1280×800 (or 640×400), PNG/JPEG.
- [ ] No sensitive data visible (logs, hostnames, emails, tokens, customer names).
- [ ] No dev artifacts (HMR overlay, console errors, `localhost:3000`).
- [ ] Light or dark theme used consistently across all shots.
- [ ] Text is legible at listing thumbnail size.
- [ ] Files saved here and referenced in `docs/CHROME_STORE_SUBMISSION.md` §6.

> Optional promo tiles (not required to publish, only for featuring): small
> promo **440×280**, marquee **1400×560**.
