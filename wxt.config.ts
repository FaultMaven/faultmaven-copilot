import { defineConfig } from 'wxt';
import { createHash } from 'node:crypto';

/**
 * Browser families whose manifest this config targets today. Named once so the
 * Chromium-only keys below cannot drift apart from each other.
 */
const CHROMIUM_TARGETS = ['chrome', 'edge', 'opera'];

/**
 * Pre-release testing against the public host: OPT-IN store identity.
 *
 * Chrome derives an extension's id from the manifest's `key` (the item's PUBLIC
 * key). An unpacked build that sets nothing takes an id derived from its
 * DIRECTORY PATH instead, so it is never the published one — and the public host
 * admits exactly one redirect, `https://<published id>.chromiumapp.org/`
 * (OAUTH_REDIRECT_URI_PATTERNS, narrowed to the store id by faultmaven#1169).
 * A release candidate therefore cannot sign in to the environment it is about to
 * ship to: GET /auth/oauth/authorize refuses it with INVALID_REDIRECT_URI before
 * consent is considered. Setting FM_STORE_KEY makes the local build take the
 * published id and exercise the REAL sign-in path, including the first-party
 * consent skip that is pinned to the same redirect.
 *
 *     FM_STORE_KEY=MIIBIjANBg... pnpm build
 *
 * then load `.output/chrome-mv3` unpacked in a profile where the store copy is
 * NOT installed — Chrome refuses two extensions with the same id.
 *
 * ‼ CHROMIUM ONLY, and that is load-bearing rather than tidy. `key` is a legal
 * Chrome key that WXT does NOT strip from the Firefox MV2 output — `stripKeys()`
 * removes only the MV2/MV3-only sets — so an ungated spread puts a meaningless
 * Chrome public key into the add-on `release.yml` publishes to AMO, where the
 * linter reports it as an unknown property. Measured, not assumed: before this
 * gate, `FM_STORE_KEY=… pnpm zip:firefox` produced `"key"` in
 * `.output/firefox-mv2/manifest.json`. Same hazard, same remedy as
 * `minimum_chrome_version`.
 *
 * ‼ The value is read from `process.env`, and WXT loads `.env`/`.env.local`
 * into `process.env` BEFORE it evaluates this factory — measured: a
 * `FM_STORE_KEY=` line in a gitignored `.env.local` reached the built manifest.
 * So this is NOT only a per-invocation variable, and a value parked in a dotenv
 * file would silently pin the published identity into every later build. That is
 * why applying it is announced on stderr: an identity-pinned build must be
 * distinguishable from a release build by looking at the build.
 *
 * Unset — every CI job, every `pnpm zip`, every release — this contributes
 * NOTHING to the manifest, which is the property
 * `src/test/manifest/store-key-optin.test.ts` holds.
 * Do not set FM_STORE_KEY in any workflow.
 *
 * The key is public (readable from any installed copy's manifest or the CRX
 * header) and is deliberately not committed: the field confers the published
 * IDENTITY on whatever unpacked build sets it, so whoever tests supplies it.
 */
function storeIdentity(browser: string): { key?: string } {
  const key = process.env.FM_STORE_KEY?.trim();
  if (!key) return {};

  if (!CHROMIUM_TARGETS.includes(browser)) {
    console.warn(`[wxt.config] FM_STORE_KEY ignored for '${browser}': the store identity is a Chromium concept.`);
    return {};
  }

  // Reject a value the browser would reject anyway. Buffer.from(_, 'base64')
  // silently drops invalid characters, so a mistyped or whitespace-mangled key
  // decodes to *something* and Chrome then refuses to load the extension at all
  // with "Invalid value for 'key'" — a failure that reads, to whoever is
  // testing, as the build being broken. Round-tripping is what makes the near
  // miss fail here instead, while the build still has a voice.
  const der = Buffer.from(key, 'base64');
  if (der.length === 0 || der.toString('base64') !== key) {
    throw new Error('FM_STORE_KEY is not valid base64 — expected the store item\'s public key (base64 SubjectPublicKeyInfo).');
  }

  // The derived id is the whole point of setting this, and printing it is what
  // turns "wrong key" into a one-glance check: only the published id can sign in
  // to the public host, so an id that is not the expected one explains the
  // INVALID_REDIRECT_URI that would otherwise follow.
  const digest = createHash('sha256').update(der).digest('hex').slice(0, 32);
  const id = [...digest].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  console.warn(`[wxt.config] FM_STORE_KEY applied — this build takes extension id ${id}. NOT a release build; do not upload it to the store.`);

  return { key };
}

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
    // Pre-release testing against the public host — OPT-IN, Chromium only.
    // See `storeIdentity` below for what this is and why it is not a default.
    ...storeIdentity(browser),
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
    ...(CHROMIUM_TARGETS.includes(browser) ? { minimum_chrome_version: "116" } : {}),
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
      "storage", "sidePanel", "scripting", "identity"
    ],
    // `tabs` is OPTIONAL, and the reason is the install dialog.
    //
    // Chrome composes that dialog from the REQUIRED permissions alone, and the
    // rule `{IDS_EXTENSION_PROMPT_WARNING_HISTORY_READ, {APIPermissionID::kTab}}`
    // (chrome_permission_message_rules.cc) means a required `tabs` puts "Read
    // your browsing history" in front of every install. That sentence describes
    // the permission honestly — `tabs` exposes the URL and title of every open
    // tab — but it describes this extension badly: the only tabs-only field read
    // anywhere is `tab.url`, and only for the tab the user just asked to
    // capture.
    //
    // Optional leaves the install dialog naming just the two FaultMaven hosts,
    // and moves the same sentence to the moment the user has clicked capture.
    // ⚠️ It is the SAME Chrome dialog, with no text of ours in it — what changes
    // is when it is shown, not how it reads. Nothing is given up either: the
    // same permission, granted later. `tabs` carries no `kFlagCannotBeOptional`
    // in chrome_api_permissions.cc, so this is a legal home for it.
    //
    // ‼ It follows that `tab.url` is UNDEFINED until the grant, for every origin
    // outside `host_permissions`. Code that reads it must say so rather than
    // mistake the absence for a tab it cannot capture — see `capturePage`.
    // Reading the url of an origin we DO hold (the Cloud dashboard) never needed
    // `tabs` and still does not, which is why side-panel reconciliation is
    // unaffected.
    optional_permissions: ["tabs"],
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
    // block gated on process.env.VITE_DASHBOARD_URL was dead — a `VITE_` value
    // reaches extension source through import.meta.env, and that block read it
    // somewhere it was not populated — so it produced nothing. Removed to avoid
    // implying custom dashboard domains are covered (they are not yet; see issue
    // #71 for runtime registration). ‼ Do not read this as "dotenv values never
    // reach process.env here": WXT loads .env/.env.local into process.env before
    // it evaluates this manifest factory, which is measured in `storeIdentity`
    // above and is exactly why that helper announces itself.
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