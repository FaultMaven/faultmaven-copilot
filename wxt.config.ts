import { defineConfig } from 'wxt';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';

/**
 * Browser families whose manifest this config targets today. Named once so the
 * Chromium-only keys below cannot drift apart from each other.
 */
const CHROMIUM_TARGETS = ['chrome', 'edge', 'opera'];

/**
 * The panel document: Chromium's `side_panel` and Firefox's `sidebar_action`
 * both point here, so the two targets cannot come to show different pages.
 */
const PANEL_PAGE = 'sidepanel_manual.html';

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

/**
 * The extension's dev server is loopback-only (fm#2662). `wxt --host <addr>`
 * binds it to the network, and WXT and Vite then trust every peer with every
 * surface they expose: any file, through WXT's virtual entrypoint ids and
 * Vite's `safeModulePaths`; server-side fetches through `/@id/url:`;
 * `/__open-in-editor`; and a tokenless HMR WebSocket. LAN access to `wxt dev`
 * was never a supported use, and the owner's ruling ends it.
 *
 * In order: without `--port`, WXT's `getPort` probe-binds the host before any
 * hook runs, and a host this machine does not own, or a non-string one, fails
 * closed there with WXT's own error. The `config:resolved` hook refuses a
 * non-loopback `dev.server.host` (the gate). The plugin's `configResolved`
 * refuses a non-loopback final `server.host` and a separate HMR server (its
 * own server, port or host, or middleware mode), before anything binds. On the server, a non-loopback peer's socket
 * is destroyed on `connection`, before any parsing; its request gets 403 and
 * its upgrade is destroyed (backstops); and a server found bound off-loopback
 * fails `wxt dev`. This keeps NETWORK peers out only: the developer's own
 * browser is a loopback peer.
 *
 * The browser's pages are kept out by an origin boundary (fm#2863), on every
 * HTTP request and every upgrade, after the peer guards. The `Host` must name
 * loopback (or `server.origin`'s host) on the bound port, which refuses
 * `http://0.0.0.0:<port>` and DNS rebinding. Then an `Origin` must be the
 * extension's or the server's own; without one, `Sec-Fetch-Site` must be
 * absent, `none` or `same-origin`. That admits extension contexts, the
 * server's own origin and loopback tools that send no browser headers, and
 * refuses every other page, another localhost port included, with a logged
 * 403 or a destroyed socket. Vite's WebSocket token check stays off because
 * WXT's own reload clients (worker and extension pages) connect without one.
 * Installed extensions are trusted and pages are not: one with a localhost
 * host permission already sends no `Origin` and `none`, and the dev id is
 * path-derived, so no id is pinned. A sandboxed extension page (`Origin:
 * null`) would be refused; the copilot has none. Measured in Chromium only:
 * `pnpm dev:firefox` (`moz-extension://`) is unverified.
 */
const LOOPBACK = new BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');

/** A peer or bound address in 127.0.0.0/8 or ::1 (IPv4-mapped included). */
export function isLoopbackPeer(address: unknown): boolean {
  if (typeof address !== 'string') return false;
  const family = isIP(address);
  return family !== 0 && LOOPBACK.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** A host that binds loopback only. Raw value, so a numeric host (`--host 0x7f000001 --port N`) is refused. */
export function isLoopbackHost(host: unknown): boolean {
  return host === 'localhost' || isLoopbackPeer(host);
}

/** `chrome-extension://<id>` or `moz-extension://<uuid>`: an origin, so no port and no path. */
export function isExtensionOrigin(origin: unknown): boolean {
  return typeof origin === 'string' && /^(?:chrome|moz)-extension:\/\/[^/:]+$/.test(origin);
}

/** The dev server's own origins on its bound port, plus the configured `server.origin`'s. */
export function ownOrigins(port: number, configured?: string): Set<string> {
  const own = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]);
  if (configured) own.add(new URL(configured).origin);
  return own;
}

/** A `Host` header naming loopback, or the configured `server.origin`'s host, on the bound port. */
export function isOwnHost(host: unknown, port: number, configured?: string): boolean {
  const match = typeof host === 'string' ? /^(\[[0-9a-f:.]+\]|[^[\]:/@]+)(?::(\d+))?$/i.exec(host) : null;
  if (!match || (match[2] ?? '80') !== String(port)) return false;
  const name = match[1].toLowerCase();
  return isLoopbackHost(name.replace(/^\[(.*)\]$/, '$1')) || (!!configured && name === new URL(configured).hostname);
}

/** With an `Origin`, only the extension's or an own one; without, `Sec-Fetch-Site` absent, `none` or `same-origin`. */
export function isAllowedRequest(origin: unknown, secFetchSite: unknown, own: Set<string>): boolean {
  if (origin !== undefined) return isExtensionOrigin(origin) || own.has(origin as string);
  return secFetchSite === undefined || secFetchSite === 'none' || secFetchSite === 'same-origin';
}

const RUN_LOCALLY = 'Run `pnpm dev` without --host; on a remote box, forward the port with `ssh -L <port>:localhost:<port>`.';

function loopbackOnlyError(problem: string, remedy = RUN_LOCALLY): Error {
  return new Error(`[wxt.config] ${problem}: the extension's dev server is loopback-only (FaultMaven/faultmaven#2662). ${remedy}`);
}

export default defineConfig({
  srcDir: 'src',
  modules: [
    '@wxt-dev/module-react'
  ],
  hooks: {
    'config:resolved': (wxt) => {
      const host = wxt.config.dev.server?.host;
      if (host !== undefined && !isLoopbackHost(host)) throw loopbackOnlyError(`Refusing dev host ${JSON.stringify(host)}`);
    },
  },
  vite: () => ({
    // No aliases. The shared UI resolves as a workspace dependency
    // (@faultmaven/copilot-ui), the same way the Dashboard will resolve it, so
    // there is no path the extension can import it by that a second host
    // cannot.
    resolve: {},
    plugins: [
      {
        name: 'faultmaven:dev-server-boundary',
        configResolved({ command, server: { host, port, hmr, middlewareMode, ws } }) {
          if (command !== 'serve') return;
          if (host !== undefined && !isLoopbackHost(host)) {
            throw loopbackOnlyError(`Refusing Vite server.host ${JSON.stringify(host)}`);
          }
          // Vite binds its own WebSocket server, on every interface, for these.
          const ownHmr = typeof hmr === 'object' && (hmr.server || (hmr.port && hmr.port !== port) || (hmr.host && !isLoopbackHost(hmr.host)));
          if (ownHmr || (middlewareMode && ws !== false)) {
            const remedy = 'Remove server.middlewareMode and server.hmr.server, .port and .host: HMR shares the dev server.';
            throw loopbackOnlyError('Refusing a separate HMR server', remedy);
          }
        },
        configureServer(server) {
          const http = server.httpServer;
          http?.prependListener('connection', function refuseNetworkSockets(socket) {
            if (!isLoopbackPeer(socket.remoteAddress)) socket.destroy();
          });
          server.middlewares.use(function refuseNetworkPeers(req, res, next) {
            if (isLoopbackPeer(req.socket.remoteAddress)) return next();
            res.statusCode = 403;
            res.end();
          });
          // The origin boundary (fm#2863). Port and origins are read per request: configureServer runs before listen.
          const warned = new Set<string>();
          const isForeign = (req: IncomingMessage, kind: string) => {
            const bound = http?.address();
            const port = typeof bound === 'object' && bound ? bound.port : NaN;
            const configured = server.config.server.origin;
            const { host, origin, 'sec-fetch-site': site } = req.headers;
            if (isOwnHost(host, port, configured) && isAllowedRequest(origin, site, ownOrigins(port, configured))) return false;
            const triple = JSON.stringify({ host, origin, 'sec-fetch-site': site });
            if (!warned.has(triple)) {
              warned.add(triple);
              server.config.logger.warn(`[wxt.config] Refused a dev-server ${kind} for ${JSON.stringify(req.url)} with ${triple}: only the extension and the server's own origin reach it (FaultMaven/faultmaven#2863).`, { timestamp: true });
            }
            return true;
          };
          server.middlewares.use(function refuseForeignRequests(req, res, next) {
            if (!isForeign(req, 'request')) return next();
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Refused: this dev server answers only the extension and its own origin (FaultMaven/faultmaven#2863).\n');
          });
          // Prepended in reverse, so the peer guard runs first and this second, both ahead of Vite's.
          http?.prependListener('upgrade', function refuseForeignUpgrades(req, socket) {
            if (isForeign(req, 'upgrade')) socket.destroy();
          });
          http?.prependListener('upgrade', function refuseNetworkUpgrades(req, socket) {
            if (!isLoopbackPeer(req.socket.remoteAddress)) socket.destroy();
          });
          http?.on('listening', function refuseOffLoopbackBind() {
            const bound = http.address();
            const address = typeof bound === 'object' ? bound?.address : bound;
            if (isLoopbackPeer(address)) return;
            const problem = `The dev server bound ${JSON.stringify(address)}, off loopback, and was closed`;
            const causes = 'Look for a later `server.host` override (a hook or plugin), or a `localhost` that resolves off-loopback.';
            // Vite's listen() rejects on this error, so `wxt dev` fails instead of running half-alive.
            http.emit('error', loopbackOnlyError(problem, causes));
            void server.close();
          });
        },
      },
    ],
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
    //
    // `sidePanel` is Chromium-only, gated like `key` and
    // `minimum_chrome_version`: Firefox has no such permission (its panel is the
    // `sidebar_action` below, which needs none), WXT does not strip it, and
    // AMO's linter reports it as invalid.
    permissions: [
      "storage",
      ...(CHROMIUM_TARGETS.includes(browser) ? ["sidePanel"] : []),
      "scripting",
      "identity"
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
      default_path: PANEL_PAGE
    },
    // Firefox's counterpart of `side_panel`. WXT strips `side_panel` from the
    // MV2 output and does not translate it (it emits `sidebar_action` only for
    // a `sidepanel` ENTRYPOINT, and this panel is declared by hand), so without
    // this the Firefox build had no surface that showed the panel at all. The
    // toolbar icon opens it through `sidebarAction.open()` (background.ts,
    // `registerToolbarPanelOpener`).
    //
    // Firefox only: WXT does not strip the key from the Chrome output, and
    // Chrome does not know it — the same kind of leak `minimum_chrome_version`
    // is gated against, in the other direction.
    ...(browser === 'firefox'
      ? {
          sidebar_action: {
            default_panel: PANEL_PAGE,
            default_title: "__MSG_appName__",
            // Firefox opens a new add-on's sidebar on install unless told
            // not to. Chrome never opens the side panel unasked; the toolbar
            // icon is how the panel is reached on both.
            open_at_install: false,
            default_icon: {
              "16": "icon/px16-square-dark.png",
              "32": "icon/px32-square-dark.png"
            }
          }
        }
      : {}),
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