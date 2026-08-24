import { defineConfig } from 'wxt';
import path from 'node:path';

export default defineConfig({
  srcDir: 'src',
  modules: [
    '@wxt-dev/module-react'
  ],
  vite: () => ({
    resolve: {
      alias: {
        '~': path.resolve(__dirname, 'src'),
        '~lib': path.resolve(__dirname, 'src/lib'),
      },
    },
  }),
  manifest: ({ browser }) => ({
    name: "__MSG_appName__",
    // No `version` here: WXT derives the manifest version from package.json,
    // which is the single source. A second copy in this file drifted onto
    // every release bump, and Chrome refuses an upload whose version does not
    // strictly increase — so a missed copy here is a rejected upload.
    description: "__MSG_appDescription__",
    default_locale: 'en',
    // The panel is opened programmatically from the toolbar-icon handler
    // (sidePanel.open, Chrome 116+), so an older Chromium would install the
    // extension and then fail at the one action that reveals its entire UI.
    // Declare the floor instead and let the browser refuse the install.
    //
    // Chromium targets only, and the guard is load-bearing: this `manifest`
    // block is shared by every target, and WXT does NOT strip the key from the
    // Firefox MV2 output the way it strips `side_panel` — it is a legal Chrome
    // MV2 key, so AMO receives it as an unknown property and warns. release.yml
    // publishes that zip.
    //
    // Membership rather than `browser !== 'firefox'`: the inverse form trades a
    // floor that silently vanishes on a future `-b edge` for a key that
    // silently leaks into a future `-b safari`, which would not understand it
    // either. Only chrome and firefox are built today; naming the family
    // handles both future targets correctly.
    ...(['chrome', 'edge', 'opera'].includes(browser) ? { minimum_chrome_version: "116" } : {}),
    icons: {
      "16": "icon/px16-square-dark.png",
      "32": "icon/px32-square-dark.png",
      "48": "icon/px48-square-dark.png",
      "96": "icon/px96-square-dark.png",
      "128": "icon/px128-square-dark.png"
    },
    // `identity` powers the sign-in window (identity.launchWebAuthFlow). The
    // browser owns that window: it opens it, and it CLOSES it the moment the
    // flow redirects back — which is why sign-in no longer leaves a tab behind
    // for us to hunt down and remove. That window lifecycle is the whole reason
    // for the permission; it is not a security boundary (see the redirect-URI
    // note in lib/auth/dashboard-oauth.ts).
    //
    // Keep the Chrome Web Store listing's permission justifications in step
    // with this list — store review compares the two. (The submission
    // collateral is maintained outside this repo.)
    // No `activeTab`: it only activates on a toolbar-icon click, and our
    // toolbar click just opens the side panel — page capture runs from a
    // side-panel button, where activeTab never activates, so the capture path
    // requests per-origin host permission instead (usePageContent.ts). A
    // declared-but-unused permission is a CWS rejection trigger.
    permissions: [
      "storage", "sidePanel", "tabs", "scripting", "identity"
    ],
    host_permissions: [
      "https://app.faultmaven.ai/*",
      "https://api.faultmaven.ai/*"
    ],
    optional_host_permissions: [
      "http://localhost/*",
      "http://127.0.0.1/*",
      "http://*/*",
      "https://*/*"
    ],
    action: {
      default_title: "Open FaultMaven Copilot",
      default_icon: {
        "16": "icon/px16-square-dark.png",
        "32": "icon/px32-square-dark.png"
      }
    },
    side_panel: {
      default_path: "sidepanel_manual.html"
    },
    // NOTE: the auth-bridge content script is declared via its WXT entrypoint
    // (src/entrypoints/auth-bridge.content.ts), not here. A previous manifest
    // block gated on process.env.VITE_DASHBOARD_URL was dead — Vite .env vars
    // populate import.meta.env, not process.env, at config-eval time — so it
    // produced nothing. Removed to avoid implying custom dashboard domains are
    // covered (they are not yet; see issue #71 for runtime registration).
    // connect-src allows http: and https: because the extension communicates
    // with a user-configured backend that may be self-hosted on any origin.
    // The specific origin is set by the user in Settings; this CSP allows
    // the fetch without requiring a manifest permission for every possible
    // self-hosted domain.
    content_security_policy: {
      "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' http: https:;"
    }
  })
});