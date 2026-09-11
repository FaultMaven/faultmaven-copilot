import { defineConfig } from 'wxt';
import path from 'node:path';

export default defineConfig({
  srcDir: 'src',
  modules: [
    '@wxt-dev/module-react'
  ],
  vite: () => ({
    // No aliases. The shared UI resolves as a workspace dependency
    // (@faultmaven/copilot-ui), the same way the Dashboard will resolve it, so
    // there is no path the extension can import it by that a second host
    // cannot.
    resolve: {},
  }),
  manifest: ({ browser }) => ({
    name: "__MSG_appName__",
    // No `version`: WXT derives it from package.json (the single source);
    // release.yml asserts the built manifests match the release tag.
    description: "__MSG_appDescription__",
    default_locale: 'en',
    // Pre-release testing against the public host: OPT-IN store identity.
    //
    // Chrome derives an extension's id from this `key` (the item's PUBLIC key),
    // and an unpacked build that sets nothing takes an id derived from its
    // DIRECTORY PATH instead — so a local build is never the published one. The
    // public host admits exactly one redirect,
    // `https://<published id>.chromiumapp.org/` (OAUTH_REDIRECT_URI_PATTERNS,
    // narrowed to the store id by faultmaven#1169), so a local build cannot sign
    // in there at all: GET /auth/oauth/authorize refuses with
    // INVALID_REDIRECT_URI and the dashboard renders its generic "not one this
    // FaultMaven deployment recognises" page. That is the deployment working as
    // designed; it is also what makes a release candidate untestable against the
    // environment it is about to ship to.
    //
    // Setting this makes a local build take the published id, so the release
    // candidate exercises the REAL sign-in path — including the first-party
    // consent skip, which is pinned to the same redirect and would otherwise
    // behave differently in testing than in production.
    //
    // ‼ OPT-IN, and it must stay that way. Unset — which is every CI job, every
    // `pnpm zip`, and every release — this spreads NOTHING into the manifest, so
    // the shipped artifact is byte-identical to what it was before this block
    // existed. That is the whole reason it is an env var and not a committed
    // value: a testing affordance must not move the thing being tested. Do not
    // set FM_STORE_KEY in any workflow.
    //
    // The value is the store item's public key (base64 SubjectPublicKeyInfo),
    // which is not a secret but is deliberately not committed here — it is read
    // from an installed copy's manifest (`key`) or from the CRX header, by
    // whoever is doing the testing:
    //
    //     FM_STORE_KEY=MIIBIjANBg... pnpm build
    //
    // then load `.output/chrome-mv3` unpacked in a profile where the store copy
    // is NOT installed — Chrome refuses two extensions with the same id. The key
    // fixes the local id and nothing else; what may be published is governed by
    // the developer account, not by this field.
    ...(process.env.FM_STORE_KEY ? { key: process.env.FM_STORE_KEY } : {}),
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