import type { IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';
import type { Plugin } from 'vite';

/**
 * The origin boundary every Vite dev server in this repo installs: `wxt dev`
 * (`wxt.config.ts`) and the playground (`playground/vite.config.ts`), fm#2872.
 * Each passes its network rule.
 *
 * `loopback-only` is the extension's (fm#2662). `wxt --host <addr>` binds the
 * server to the network, and WXT and Vite then trust every peer with every
 * surface they expose: any file, through WXT's virtual entrypoint ids and
 * Vite's `safeModulePaths`; server-side fetches through `/@id/url:`;
 * `/__open-in-editor`; and a tokenless HMR WebSocket. In order: without
 * `--port`, WXT's `getPort` probe-binds the host before any hook runs, and a
 * host this machine does not own, or a non-string one, fails closed there with
 * WXT's own error. The `config:resolved` hook in `wxt.config.ts` refuses a
 * non-loopback `dev.server.host` (the gate). The plugin's `configResolved`
 * refuses a non-loopback final `server.host` and a separate HMR server (its
 * own server, port or host, or middleware mode), before anything binds. On the
 * server, a non-loopback peer's socket is destroyed on `connection`, before any
 * parsing; its request gets 403 and its upgrade is destroyed (backstops); and a
 * server found bound off-loopback fails `wxt dev`. This keeps NETWORK peers
 * out only: the developer's own browser is a loopback peer.
 *
 * `lan-opt-in` is the playground's: loopback by default, and `pnpm playground
 * --host` serves the LAN by IP address (fm#2425, fm#2630). None of the above
 * is installed.
 *
 * The browser's pages are kept out by the origin boundary (fm#2863), on every
 * HTTP request and every upgrade, after any peer guards. Under `loopback-only`
 * the `Host` must be exactly `localhost`, a dotted 127/8 literal or `[::1]` on
 * the bound port, or `server.origin`'s own host and port; that refuses
 * `0.0.0.0`, IPv4-mapped spellings and DNS rebinding. Then an `Origin` must be
 * the extension's (when `extensionOrigins`) or the server's own (`localhost`
 * and the bound literal on the bound port, and `server.origin`); without one,
 * `Sec-Fetch-Site` must be absent, `none` or `same-origin`, and the `Host` a
 * loopback one. That admits extension contexts, the server's own origin and
 * loopback tools that send no browser headers, and refuses every other page,
 * another localhost port included, with a logged 403 or a destroyed socket.
 * What is own is computed on each `listening`, as normalized origins (port 80
 * names none); a `server.origin` that does not parse as an origin is ignored.
 *
 * Under `lan-opt-in` the `Host` may carry any port, so a forwarded one (Docker
 * `-p 8080:5174`, `ssh -L 9000:localhost:5174`, a devcontainer) is served: a
 * loopback `Host` on any port, and, bound off loopback (`--host`), any
 * IP-literal `Host` on any port, `0.0.0.0` and `[::ffff:127.0.0.1]` included.
 * An `Origin`, when sent, must be `http://<that Host>` (normalized) or a
 * loopback own one. Without one, a loopback `Host` keeps the `Sec-Fetch-Site`
 * rule, and an IP-literal `Host` admits a header-less request: browsers send no
 * Fetch Metadata to it. There the boundary is `Host` + `Origin` only: a foreign
 * page's request is answered, but its read stays opaque (no CORS grant). DNS
 * names stay refused.
 *
 * `/__open-in-editor`, in both modes, answers only a loopback peer on a
 * loopback `Host` on the bound port, with an admitted `Origin` or with
 * `Sec-Fetch-Site` `same-origin` (Vite's overlay) or `none` (an extension page
 * with host permission). A header-less request is refused: from a browser that
 * sends no Fetch Metadata, a foreign page's `<img>` is one. For `wxt dev` these
 * are the two changes from fm#2863's boundary (fm#2872): an editor request on
 * `server.origin`'s host, or with no headers, is now refused; and, as own
 * origins are normalized, on port 80 `Origin: http://localhost` is now own.
 *
 * `wxt dev` keeps Vite's WebSocket token check off because WXT's own reload
 * clients (worker and extension pages) connect without one. Installed
 * extensions are trusted and pages are not: one with a localhost host
 * permission already sends no `Origin` and `none`, and the dev id is
 * path-derived, so no id is pinned. A sandboxed extension page (`Origin: null`)
 * would be refused; the copilot has none. Measured in Chromium only:
 * `pnpm dev:firefox` (`moz-extension://`) is unverified.
 */
export interface DevServerBoundaryOptions {
  /** The prefix of every refusal and warning, `[wxt.config]` or `[playground]`. */
  label: string;
  network: 'loopback-only' | 'lan-opt-in';
  /** Admit `chrome-extension://` and `moz-extension://` origins. */
  extensionOrigins: boolean;
}

/** `wxt dev`'s options: what the helpers below assume when given none. */
const WXT_DEV: DevServerBoundaryOptions = { label: '[wxt.config]', network: 'loopback-only', extensionOrigins: true };

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

/** What the origin boundary admits, computed once per `listening`. */
export interface DevBoundary {
  port: number;
  /** The origins of `localhost` and the bound literal on the bound port, and a parseable `server.origin`, normalized. */
  own: Set<string>;
  /** `server.origin`'s `Host` spellings: its host and port, the scheme's default when it names none. */
  configuredHosts: Set<string>;
  extensionOrigins: boolean;
  /** `lan-opt-in`: a loopback `Host` on any port is admitted, with `Origin: http://<Host>` or an own one. */
  anyPort: boolean;
  /** `lan-opt-in` bound off loopback: so is any IP-literal `Host`, on any port. */
  lan: boolean;
}

/** Null (refuse all) unless bound to a port; a `server.origin` that is not an origin is ignored, with a warning. */
export function devBoundary(
  bound: unknown,
  configured: unknown,
  warn: (message: string) => void,
  { label, network, extensionOrigins }: DevServerBoundaryOptions = WXT_DEV,
): DevBoundary | null {
  if (typeof bound !== 'object' || bound === null) return null;
  const { address, port } = bound as { address: unknown; port: unknown };
  if (typeof port !== 'number') return null;
  const originOf = (host: string) => new URL(`http://${host}:${port}`).origin;
  const own = new Set([originOf('localhost')]);
  if (isIP(String(address)) === 4 && isLoopbackPeer(address)) own.add(originOf(String(address)));
  if (address === '::1') own.add(originOf('[::1]'));
  const configuredHosts = new Set<string>();
  if (configured !== undefined) {
    let url: URL | undefined;
    try {
      url = new URL(String(configured));
    } catch {
      url = undefined;
    }
    if (url && url.origin !== 'null') {
      own.add(url.origin);
      configuredHosts.add(`${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`);
      if (!url.port) configuredHosts.add(url.hostname);
    } else {
      warn(`${label} Ignoring server.origin ${JSON.stringify(configured)}: not an origin, so only loopback hosts reach the dev server (FaultMaven/faultmaven#2863).`);
    }
  }
  const anyPort = network === 'lan-opt-in';
  return { port, own, configuredHosts, extensionOrigins, anyPort, lan: anyPort && !isLoopbackPeer(address) };
}

/** Exactly `localhost`, a dotted 127/8 literal or `[::1]`, on `port`; never an IPv4-mapped or other IPv6 spelling. */
export function isLoopbackHostHeader(host: unknown, port: number): boolean {
  const match = typeof host === 'string' ? /^(localhost|\[::1\]|[\d.]+)(?::(\d+))?$/.exec(host.toLowerCase()) : null;
  if (!match || (match[2] ?? '80') !== String(port)) return false;
  const name = match[1];
  return name === 'localhost' || name === '[::1]' || (isIP(name) === 4 && isLoopbackPeer(name));
}

/**
 * A loopback `Host` (`localhost`, a dotted 127/8 literal, `[::1]`) or, with `ipLiterals`, any dotted IPv4 or bracketed
 * IPv6 literal, on any port: the normalized origin a page served on it sends, else null.
 */
export function servedOrigin(host: unknown, ipLiterals: boolean): string | null {
  const match = typeof host === 'string' ? /^(localhost|\[([\da-f:.]+)\]|[\d.]+)(?::(\d+))?$/.exec(host.toLowerCase()) : null;
  if (!match) return null;
  const [, name, v6, port] = match;
  const family = name === 'localhost' ? 0 : v6 !== undefined ? 6 : 4;
  if (family !== 0 && isIP(v6 ?? name) !== family) return null;
  const loopback = name === 'localhost' || name === '[::1]' || (family === 4 && isLoopbackPeer(name));
  if (!loopback && !ipLiterals) return null;
  try {
    return new URL(`http://${name}${port === undefined ? '' : `:${port}`}`).origin;
  } catch {
    return null; // a port past 65535
  }
}

/**
 * Under `lan-opt-in`, a loopback or (bound off loopback) IP-literal `Host` on any port, whose `Origin` is its own or an
 * own one; else a loopback `Host` on the bound port with the Origin rule; or `server.origin`'s own `Host` with an
 * admitted `Origin` (never none).
 */
export function admits(boundary: DevBoundary | null, host: unknown, origin: unknown, secFetchSite: unknown): boolean {
  if (!boundary) return false;
  const { port, own, extensionOrigins } = boundary;
  const served = boundary.anyPort ? servedOrigin(host, boundary.lan) : null;
  if (served !== null) return isAllowedRequest(origin, secFetchSite, own, extensionOrigins) || origin === served;
  if (isLoopbackHostHeader(host, port)) return isAllowedRequest(origin, secFetchSite, own, extensionOrigins);
  const configured = typeof host === 'string' && boundary.configuredHosts.has(host.toLowerCase());
  return configured && origin !== undefined && isAllowedRequest(origin, secFetchSite, own, extensionOrigins);
}

/** With an `Origin`, only the extension's or an own one; without, `Sec-Fetch-Site` absent, `none` or `same-origin`. */
export function isAllowedRequest(origin: unknown, secFetchSite: unknown, own: Set<string>, extensionOrigins = true): boolean {
  if (origin !== undefined) return (extensionOrigins && isExtensionOrigin(origin)) || (typeof origin === 'string' && own.has(origin));
  return secFetchSite === undefined || secFetchSite === 'none' || secFetchSite === 'same-origin';
}

/** Vite's editor launcher; connect matches its route case-insensitively, and under any base, so match anywhere. */
const OPEN_IN_EDITOR = /\/__open-in-editor/i;

/**
 * The editor launcher answers only an admitted request from a loopback peer on a loopback `Host` on the bound port,
 * with an `Origin` or `Sec-Fetch-Site` `same-origin` or `none`: never a header-less one (fm#2872).
 */
export function admitsEditor(boundary: DevBoundary | null, req: IncomingMessage): boolean {
  if (!OPEN_IN_EDITOR.test(req.url ?? '')) return true;
  const { host, origin, 'sec-fetch-site': site } = req.headers;
  if (!boundary || !isLoopbackPeer(req.socket.remoteAddress) || !isLoopbackHostHeader(host, boundary.port)) return false;
  return admits(boundary, host, origin, site) && (origin !== undefined || site === 'same-origin' || site === 'none');
}

const RUN_LOCALLY = 'Run `pnpm dev` without --host; on a remote box, forward the port with `ssh -L <port>:localhost:<port>`.';

export function loopbackOnlyError(label: string, problem: string, remedy = RUN_LOCALLY): Error {
  return new Error(`${label} ${problem}: the extension's dev server is loopback-only (FaultMaven/faultmaven#2662). ${remedy}`);
}

/** The Vite plugin: the network rule `options.network` names, then the origin boundary. */
export function devServerBoundary(options: DevServerBoundaryOptions): Plugin {
  const { label, network, extensionOrigins } = options;
  const loopbackOnly = network === 'loopback-only';
  const whom = extensionOrigins ? 'the extension and ' : '';
  const reach = extensionOrigins ? "the extension and the server's own origin reach it" : "the server's own origin reaches it";
  return {
    name: 'faultmaven:dev-server-boundary',
    apply: 'serve',
    enforce: 'pre',
    configResolved({ server: { host, port, hmr, middlewareMode, ws } }) {
      if (!loopbackOnly) return;
      if (host !== undefined && !isLoopbackHost(host)) {
        throw loopbackOnlyError(label, `Refusing Vite server.host ${JSON.stringify(host)}`);
      }
      // Vite binds its own WebSocket server, on every interface, for these.
      const ownHmr = typeof hmr === 'object' && (hmr.server || (hmr.port && hmr.port !== port) || (hmr.host && !isLoopbackHost(hmr.host)));
      if (ownHmr || (middlewareMode && ws !== false)) {
        const remedy = 'Remove server.middlewareMode and server.hmr.server, .port and .host: HMR shares the dev server.';
        throw loopbackOnlyError(label, 'Refusing a separate HMR server', remedy);
      }
    },
    configureServer(server) {
      const http = server.httpServer;
      if (loopbackOnly) {
        http?.prependListener('connection', function refuseNetworkSockets(socket) {
          if (!isLoopbackPeer(socket.remoteAddress)) socket.destroy();
        });
        server.middlewares.use(function refuseNetworkPeers(req, res, next) {
          if (isLoopbackPeer(req.socket.remoteAddress)) return next();
          res.statusCode = 403;
          res.end();
        });
      }
      // The origin boundary (fm#2863), computed on each `listening` (configureServer runs before listen), so a
      // request does no syscall and no parse. Until then, everything is refused.
      let boundary: DevBoundary | null = null;
      http?.on('listening', function computeDevBoundary() {
        boundary = devBoundary(http.address(), server.config.server.origin, (m) => server.config.logger.warn(m), options);
      });
      const warned = new Set<string>();
      const clip = (value: unknown) => (typeof value === 'string' && value.length > 200 ? `${value.slice(0, 200)}…` : value);
      const isForeign = (req: IncomingMessage, kind: string) => {
        const { host, origin, 'sec-fetch-site': site } = req.headers;
        if (admits(boundary, host, origin, site) && admitsEditor(boundary, req)) return false;
        const triple = JSON.stringify({ host: clip(host), origin: clip(origin), 'sec-fetch-site': clip(site) });
        // Page-chosen values: log the first 50 distinct triples, then say once that the rest are not logged.
        if (warned.has(triple) || warned.size > 50) return true;
        warned.add(triple);
        server.config.logger.warn(
          warned.size > 50
            ? `${label} Further refused dev-server requests are not logged (FaultMaven/faultmaven#2863).`
            : `${label} Refused a dev-server ${kind} for ${JSON.stringify(clip(req.url))} with ${triple}: only ${reach} (FaultMaven/faultmaven#2863).`,
          { timestamp: true },
        );
        return true;
      };
      server.middlewares.use(function refuseForeignRequests(req, res, next) {
        if (!isForeign(req, 'request')) return next();
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Refused: this dev server answers only ${whom}its own origin (FaultMaven/faultmaven#2863).\n`);
      });
      // Prepended in reverse, so the peer guard (loopback-only) runs first and this second, both ahead of Vite's.
      http?.prependListener('upgrade', function refuseForeignUpgrades(req, socket) {
        if (isForeign(req, 'upgrade')) socket.destroy();
      });
      if (!loopbackOnly) return;
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
        http.emit('error', loopbackOnlyError(label, problem, causes));
        void server.close();
      });
    },
  };
}
