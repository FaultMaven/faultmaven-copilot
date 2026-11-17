// @vitest-environment node
/**
 * `pnpm dev` is `wxt`, and `wxt --host <addr>` binds its Vite server to the
 * network, where WXT and Vite trust every peer with every surface they expose
 * (fm#2662). `wxt.config.ts` keeps the server on loopback: its
 * `config:resolved` hook refuses a non-loopback host, and its plugin refuses
 * a non-loopback final `server.host` or a separate HMR server (its own server,
 * port or host, or middleware mode) before anything binds, destroys a
 * non-loopback peer's socket before any parsing (its request and upgrade
 * guards are backstops), and fails `wxt dev` on a server found bound
 * off-loopback. Behind those guards, an origin boundary refuses every browser
 * page but the extension's and the server's own (fm#2863). Every server here
 * is WXT's own, from the checkout's config, on loopback.
 */
import { describe, it, expect, vi } from 'vitest';
import childProcess, { type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InlineConfig, ViteDevServer } from 'vite';
import { createServer as createWxtServer, type InlineConfig as WxtInlineConfig, type Logger } from 'wxt';
import { admits, devBoundary, isLoopbackHost, isLoopbackHostHeader } from '../../../dev-server-boundary';

const TIMEOUT = 60_000;
const repoRoot = process.cwd();

const quiet: Logger = {
  debug() {}, log() {}, info() {}, warn() {}, error() {}, fatal() {}, success() {}, level: 0,
};

/** An OS-assigned free loopback port, picked as playwright.config.ts picks one. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

interface StartOptions {
  onVite?: (server: ViteDevServer) => void;
  /** Applied to Vite's final config, as a later `vite:devServer:extendConfig` hook would. */
  extend?: (config: InlineConfig) => void;
  /** Inline WXT hooks, merged over (and so replacing) the checkout's own of the same name. */
  hooks?: WxtInlineConfig['hooks'];
  /** Further inline WXT config (an output directory, an entrypoint filter). */
  inline?: WxtInlineConfig;
}

/**
 * WXT's own dev server from the checkout's config, with `dev.server.host` set
 * and an explicit port. That is not the CLI path: without `--port`, WXT's
 * `getPort` probe-binds the host before any hook runs, and a host this machine
 * does not own fails closed there, in WXT. The test adds only a scratch cache,
 * no dependency scan and no warm-up.
 */
async function startWxt(host: unknown, { onVite = () => {}, extend = () => {}, hooks = {}, inline = {} }: StartOptions = {}) {
  const port = await freePort();
  const cacheDir = await mkdtemp(join(tmpdir(), 'wxt-dev-loopback-'));
  try {
    const wxt = await createWxtServer({
      ...inline,
      root: repoRoot,
      logger: quiet,
      webExt: { disabled: true },
      dev: { server: { host: host as string, port } },
      hooks: {
        ...hooks,
        'vite:devServer:extendConfig': (config: InlineConfig) => {
          config.cacheDir = cacheDir;
          config.optimizeDeps = { ...config.optimizeDeps, noDiscovery: true, include: [] };
          config.server = { ...config.server, preTransformRequests: false };
          extend(config);
          config.plugins = [...(config.plugins ?? []), { name: 'capture-server', configureServer: onVite }];
        },
      },
    });
    return { wxt, port, cleanup: () => rm(cacheDir, { recursive: true, force: true }) };
  } catch (error) {
    await rm(cacheDir, { recursive: true, force: true });
    throw error;
  }
}

async function withLoopbackServer(run: (vite: ViteDevServer, port: number) => Promise<void>, options: StartOptions = {}) {
  let vite: ViteDevServer | undefined;
  const { wxt, port, cleanup } = await startWxt('127.0.0.1', { ...options, onVite: (s) => void (vite = s) });
  try {
    if (!vite) throw new Error('WXT created no Vite server');
    await vite.listen();
    await run(vite, port);
  } finally {
    await wxt.stop();
    await cleanup();
  }
}

/** Refused outcomes of a start: its error message, or 'started'. */
async function refusal(started: ReturnType<typeof startWxt>): Promise<string> {
  return started.then(
    async ({ wxt, cleanup }) => {
      await wxt.stop();
      await cleanup();
      return 'started';
    },
    (error: Error) => error.message,
  );
}

/** A raw request over node:http (the suite's setup replaces `fetch`); an upgrade resolves 101, a reset 'reset'. */
function send(port: number, path: string, headers: Record<string, string> = {}): Promise<number | string> {
  return new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('upgrade', (_res, socket) => {
      socket.destroy();
      resolve(101);
    });
    req.on('error', () => resolve('reset'));
    req.end();
  });
}

const HMR_UPGRADE = {
  Connection: 'Upgrade',
  Upgrade: 'websocket',
  'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
  'Sec-WebSocket-Version': '13',
  'Sec-WebSocket-Protocol': 'vite-hmr',
};

const NETWORK_PEERS = ['192.168.0.5', '10.0.0.1', '::ffff:192.168.0.5', 'fe80::1', undefined, ''];
const LOOPBACK_PEERS = ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1'];

describe('wxt dev is loopback-only (fm#2662)', () => {
  it.each(['0.0.0.0', '::', '192.168.1.5'])(
    'refuses to start on %s',
    async (host) => {
      const outcome = await refusal(startWxt(host));
      expect(outcome).toMatch(/Refusing dev host .*faultmaven#2662/);
      expect(outcome).toContain('`pnpm dev`');
      expect(outcome).toContain('ssh -L');
    },
    TIMEOUT,
  );

  it(
    'starts on 127.0.0.1 and serves loopback: the Vite client and the HMR upgrade',
    () =>
      withLoopbackServer(async (_vite, port) => {
        expect(await send(port, '/@vite/client')).toBe(200);
        expect(await send(port, '/', HMR_UPGRADE)).toBe(101);
      }),
    TIMEOUT,
  );

  it(
    'refuses a network peer ahead of WXT and Vite, and admits a loopback one',
    () =>
      withLoopbackServer(async (vite) => {
        // The installed handlers, in place: first in the middleware stack and first on `upgrade`.
        const guard = vite.middlewares.stack[0].handle as (
          req: IncomingMessage,
          res: ServerResponse,
          next: () => void,
        ) => void;
        expect(guard.name).toBe('refuseNetworkPeers');
        const upgradeGuard = vite.httpServer!.listeners('upgrade')[0] as (req: IncomingMessage, socket: Socket) => void;
        expect(upgradeGuard.name).toBe('refuseNetworkUpgrades');

        for (const remoteAddress of [...NETWORK_PEERS, ...LOOPBACK_PEERS]) {
          const loopback = LOOPBACK_PEERS.includes(remoteAddress as string);
          const socket = { remoteAddress, destroy: vi.fn() };
          const req = { socket } as unknown as IncomingMessage;
          const res = { statusCode: 200, end: vi.fn() };
          const next = vi.fn();
          guard(req, res as unknown as ServerResponse, next);
          upgradeGuard(req, socket as unknown as Socket);
          expect({ remoteAddress, next: next.mock.calls.length, status: res.statusCode, ended: res.end.mock.calls })
            .toEqual({ remoteAddress, next: loopback ? 1 : 0, status: loopback ? 200 : 403, ended: loopback ? [] : [[]] });
          expect({ remoteAddress, destroyed: socket.destroy.mock.calls.length }).toEqual({
            remoteAddress,
            destroyed: loopback ? 0 : 1,
          });
        }
      }),
    TIMEOUT,
  );

  it.each<[string, StartOptions, RegExp]>([
    // An inline `config:resolved` replaces the checkout's gate; the plugin still refuses.
    ['an inline hook over the gate', { hooks: { 'config:resolved': () => {} } }, /Refusing Vite server.host "192.168.1.5"/],
    ['a later server.host', { extend: (c) => void (c.server!.host = '0.0.0.0') }, /Refusing Vite server.host "0.0.0.0"/],
    ['hmr.port', { extend: (c) => void (c.server!.hmr = { port: 1 }) }, /separate HMR server/],
    ['hmr.server', { extend: (c) => void (c.server!.hmr = { server: createHttpServer() }) }, /separate HMR server/],
    ['hmr.host', { extend: (c) => void (c.server!.hmr = { host: '0.0.0.0' }) }, /separate HMR server/],
    // A loopback hmr, so only middleware mode (Vite's own HMR server, on every interface) refuses it.
    ['middleware mode', { extend: (c) => void Object.assign(c.server!, { middlewareMode: true, hmr: { port: c.server!.port, host: '127.0.0.1' } }) }, /separate HMR server/],
  ])(
    'refuses %s before anything binds',
    async (_label, options, message) => {
      const host = options.hooks ? '192.168.1.5' : '127.0.0.1';
      const outcome = await refusal(startWxt(host, options));
      expect(outcome).toMatch(message);
      expect(outcome).toMatch(/faultmaven#2662/);
    },
    TIMEOUT,
  );

  it(
    'destroys a network peer\'s socket on connection, before any parsing',
    () =>
      withLoopbackServer(async (vite, port) => {
        const http = vite.httpServer!;
        expect(http.listeners('connection')[0].name).toBe('refuseNetworkSockets');
        let fromNetwork = true;
        const reached = { request: 0, upgrade: 0 };
        http.on('request', () => reached.request++);
        http.on('upgrade', () => reached.upgrade++);
        // Ahead of the guard: the socket reports a network peer's address.
        http.prependListener('connection', (socket: Socket) => {
          if (fromNetwork) Object.defineProperty(socket, 'remoteAddress', { value: '192.168.0.5' });
        });
        expect([await send(port, '/@vite/client'), await send(port, '/', HMR_UPGRADE)]).toEqual(['reset', 'reset']);
        expect(reached).toEqual({ request: 0, upgrade: 0 });
        fromNetwork = false;
        expect([await send(port, '/@vite/client'), await send(port, '/', HMR_UPGRADE)]).toEqual([200, 101]);
        expect(reached).toEqual({ request: 1, upgrade: 1 });
      }),
    TIMEOUT,
  );

  it(
    'fails `wxt dev` on a server found bound off-loopback',
    async () => {
      // The bind a `localhost` resolving off-loopback would produce; the real bind stays loopback.
      const onVite = (vite: ViteDevServer) => {
        const http = vite.httpServer!;
        const real = http.address.bind(http);
        vi.spyOn(http, 'address').mockImplementation(() => ({ ...(real() as AddressInfo), address: '0.0.0.0' }));
      };
      const { wxt, cleanup } = await startWxt('127.0.0.1', { onVite });
      try {
        await expect(wxt.start()).rejects.toThrow(/bound "0.0.0.0", off loopback, and was closed.*faultmaven#2662/);
        expect(wxt.currentOutput).toBeUndefined();
      } finally {
        await wxt.stop();
        await cleanup();
      }
    },
    TIMEOUT,
  );
});

/** A raw HTTP exchange: status, headers and body. */
function exchange(port: number, path: string, headers: Record<string, string> = {}, method = 'GET') {
  return new Promise<{ status: number; headers: IncomingMessage['headers']; body: string }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers, method }, (res) => {
      let body = '';
      res.setEncoding('utf8').on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const EXTENSION = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const FIREFOX = 'moz-extension://3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const EVIL = 'http://evil.example';
/** Malformed extension origins and a foreign one dressed as same-origin: each refused. */
const MALFORMED = ['chrome-extension://x:1', 'chrome-extension://x/'];

describe('wxt dev refuses foreign origins and hosts (fm#2863)', () => {
  it(
    'installs the origin boundary second, behind the peer guards',
    () =>
      withLoopbackServer(async (vite) => {
        expect(vite.middlewares.stack.slice(0, 2).map((layer) => (layer.handle as { name: string }).name))
          .toEqual(['refuseNetworkPeers', 'refuseForeignRequests']);
        expect(vite.httpServer!.listeners('upgrade').slice(0, 2).map((listener) => listener.name))
          .toEqual(['refuseNetworkUpgrades', 'refuseForeignUpgrades']);
      }),
    TIMEOUT,
  );

  it(
    'admits an upgrade only from the extension, its own origin or no Origin, on a loopback Host',
    () =>
      withLoopbackServer(async (_vite, port) => {
        const rows: Record<string, Record<string, string>> = {
          [EVIL]: { Origin: EVIL },
          null: { Origin: 'null' },
          'another localhost port': { Origin: 'http://localhost:3333' },
          'a localhost subdomain': { Origin: `http://evil.localhost:${port}` },
          https: { Origin: `https://localhost:${port}` },
          'vite-ping from evil': { Origin: EVIL, 'Sec-WebSocket-Protocol': 'vite-ping' },
          [MALFORMED[0]]: { Origin: MALFORMED[0] },
          [MALFORMED[1]]: { Origin: MALFORMED[1] },
          'Host 0.0.0.0': { Host: `0.0.0.0:${port}` },
          'Host evil.example': { Host: `evil.example:${port}` },
          'Host [::ffff:7f00:1]': { Host: `[::ffff:7f00:1]:${port}` },
          'Host [::ffff:127.0.0.1]': { Host: `[::ffff:127.0.0.1]:${port}` },
          'the other family\'s literal': { Origin: `http://[::1]:${port}` },
          chrome: { Origin: EXTENSION },
          firefox: { Origin: FIREFOX },
          'own localhost': { Origin: `http://localhost:${port}` },
          'own 127.0.0.1': { Origin: `http://127.0.0.1:${port}` },
          'no Origin': {},
        };
        const outcomes: Record<string, number | string> = {};
        for (const [label, headers] of Object.entries(rows)) outcomes[label] = await send(port, '/', { ...HMR_UPGRADE, ...headers });
        const admitted = ['chrome', 'firefox', 'own localhost', 'own 127.0.0.1', 'no Origin'];
        expect(outcomes).toEqual(Object.fromEntries(Object.keys(rows).map((l) => [l, admitted.includes(l) ? 101 : 'reset'])));
      }),
    TIMEOUT,
  );

  it(
    'spawns the editor only for an extension, own-origin or header-less request, and logs each refusal once',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'wxt-dev-editor-'));
      const editor = join(dir, 'editor.sh');
      await writeFile(editor, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${join(dir, 'log')}'\n`);
      await chmod(editor, 0o755);
      vi.stubEnv('LAUNCH_EDITOR', editor);
      const spawn = vi.spyOn(childProcess, 'spawn');
      try {
        await withLoopbackServer(async (vite, port) => {
          const warn = vi.spyOn(vite.config.logger, 'warn').mockImplementation(() => {});
          const rows: Record<string, [Record<string, string>, string?]> = {
            'cross-site': [{ 'Sec-Fetch-Site': 'cross-site' }],
            'same-site': [{ 'Sec-Fetch-Site': 'same-site' }],
            [EVIL]: [{ Origin: EVIL }],
            null: [{ Origin: 'null' }],
            'evil as same-origin': [{ Origin: EVIL, 'Sec-Fetch-Site': 'same-origin' }],
            [MALFORMED[0]]: [{ Origin: MALFORMED[0] }],
            [MALFORMED[1]]: [{ Origin: MALFORMED[1] }],
            'Host 0.0.0.0': [{ Host: `0.0.0.0:${port}` }],
            // Vite's own host check admits IP literals, so the gate alone decides these.
            'Host [::ffff:7f00:1]': [{ Host: `[::ffff:7f00:1]:${port}` }],
            'Host [::ffff:127.0.0.1]': [{ Host: `[::ffff:127.0.0.1]:${port}` }],
            'the other family\'s literal': [{ Origin: `http://[::1]:${port}` }],
            'no headers': [{}],
            none: [{ 'Sec-Fetch-Site': 'none' }],
            'same-origin': [{ 'Sec-Fetch-Site': 'same-origin' }],
            'extension, cross-site': [{ Origin: EXTENSION, 'Sec-Fetch-Site': 'cross-site' }],
            'own-origin POST': [{ Origin: `http://localhost:${port}` }, 'POST'],
          };
          const outcomes: Record<string, [number, number]> = {};
          for (const [label, [headers, method]] of Object.entries(rows)) {
            const before = spawn.mock.calls.length;
            // An existing file with a position, as the overlay sends: launch-editor skips a missing file.
            const { status } = await exchange(port, '/__open-in-editor?file=package.json:1:1', headers, method);
            outcomes[label] = [status, spawn.mock.calls.length - before];
          }
          const admitted = ['no headers', 'none', 'same-origin', 'extension, cross-site', 'own-origin POST'];
          expect(outcomes).toEqual(Object.fromEntries(Object.keys(rows).map((l) => [l, admitted.includes(l) ? [200, 1] : [403, 0]])));
          // Each spawn ran: the stub logged one line per admitted row.
          await Promise.all(spawn.mock.results.map(({ value }) => (value as ChildProcess).exitCode === null && once(value as ChildProcess, 'exit')));
          expect((await readFile(join(dir, 'log'), 'utf8')).trim().split('\n').length).toBe(admitted.length);

          // Visible: a text body naming the issue, and one warning per distinct refused triple.
          const refused = await exchange(port, '/__open-in-editor', { Origin: EVIL });
          expect([refused.status, refused.headers['content-type'], refused.body]).toEqual([403, 'text/plain; charset=utf-8', expect.stringContaining('FaultMaven/faultmaven#2863')]);
          await send(port, '/', { ...HMR_UPGRADE, Origin: 'http://localhost:3333' });
          await send(port, '/', { ...HMR_UPGRADE, Origin: 'http://localhost:3333' });
          const warnings = warn.mock.calls.map(([message]) => message);
          expect(warnings).toHaveLength(Object.keys(rows).length - admitted.length + 1);
          expect(warnings.every((m) => m.includes('FaultMaven/faultmaven#2863'))).toBe(true);
          expect(warnings.at(-1)).toMatch(/Refused a dev-server upgrade for "\/" with .*localhost:3333/);
        });
      } finally {
        spawn.mockRestore();
        vi.unstubAllEnvs();
        await rm(dir, { recursive: true, force: true });
      }
    },
    TIMEOUT,
  );

  it(
    'serves a module to the extension, and refuses it, with no CORS grant, to another localhost port',
    () =>
      withLoopbackServer(async (_vite, port) => {
        const foreign = await exchange(port, '/@vite/client', { Origin: 'http://localhost:3333' });
        expect([foreign.status, foreign.headers['access-control-allow-origin']]).toEqual([403, undefined]);
        const extension = await exchange(port, '/@vite/client', { Origin: EXTENSION });
        expect(extension.status).toBe(200);
      }),
    TIMEOUT,
  );

  it(
    'admits server.origin on its own host and port, and only with an admitted Origin',
    () =>
      withLoopbackServer(
        async (_vite, port) => {
          const own = 'http://dev.test:4000';
          const rows: Record<string, Record<string, string>> = {
            'its Host, its Origin': { Host: 'dev.test:4000', Origin: own },
            'its Host, an extension Origin': { Host: 'dev.test:4000', Origin: EXTENSION },
            'its Host, no Origin': { Host: 'dev.test:4000' },
            'its Host, no Origin, none': { Host: 'dev.test:4000', 'Sec-Fetch-Site': 'none' },
            'its host on the bound port': { Host: `dev.test:${port}`, Origin: own },
            'its host with no port': { Host: 'dev.test', Origin: own },
            'a loopback Host, its Origin': { Origin: own },
          };
          const outcomes: Record<string, [number, number | string]> = {};
          for (const [label, headers] of Object.entries(rows)) {
            outcomes[label] = [(await exchange(port, '/@vite/client', headers)).status, await send(port, '/', { ...HMR_UPGRADE, ...headers })];
          }
          const admitted = ['its Host, its Origin', 'its Host, an extension Origin', 'a loopback Host, its Origin'];
          expect(outcomes).toEqual(Object.fromEntries(Object.keys(rows).map((l) => [l, admitted.includes(l) ? [200, 101] : [403, 'reset']])));
        },
        // Vite's own host check would refuse dev.test; a developer setting server.origin allows it too.
        { extend: (c) => void Object.assign(c.server!, { origin: 'http://dev.test:4000', allowedHosts: ['dev.test'] }) },
      ),
    TIMEOUT,
  );

  it.each(['http://::1', 'dev.test:4000'])(
    'ignores a server.origin of %j that is not an origin, and stays up',
    (origin) =>
      withLoopbackServer(
        async (vite, port) => {
          // The upgrade listener runs outside any request handler: a throw there would kill `wxt dev`.
          expect(await send(port, '/', { ...HMR_UPGRADE, Origin: 'null' })).toBe('reset');
          expect(await send(port, '/', { ...HMR_UPGRADE, Origin: EXTENSION })).toBe(101);
          expect((await exchange(port, '/@vite/client', { Origin: 'null' })).status).toBe(403);
          expect((await exchange(port, '/@vite/client')).status).toBe(200);
          expect(vite.httpServer!.listening).toBe(true);
        },
        { extend: (c) => void (c.server!.origin = origin) },
      ),
    TIMEOUT,
  );

  it(
    'logs at most 50 distinct refusals, each value truncated, then one notice',
    () =>
      withLoopbackServer(async (vite, port) => {
        const warn = vi.spyOn(vite.config.logger, 'warn').mockImplementation(() => {});
        for (let i = 0; i < 60; i++) await exchange(port, '/@vite/client', { Origin: `http://p${i}.example${'x'.repeat(1000)}` });
        const warnings = warn.mock.calls.map(([message]) => message);
        expect(warnings).toHaveLength(51);
        expect(warnings.at(-1)).toMatch(/Further refused dev-server requests are not logged/);
        expect(Math.max(...warnings.map((m) => m.length))).toBeLessThan(600);
      }),
    TIMEOUT,
  );

  it(
    'lets an extension socket, and not a foreign page, drive a content-script reload',
    async () => {
      const outDir = await mkdtemp(join(tmpdir(), 'wxt-dev-out-'));
      const inline = { outDir, filterEntrypoints: ['background', 'auth-bridge'] };
      const { wxt, port, cleanup } = await startWxt('127.0.0.1', { inline });
      const open = (origin: string) =>
        new Promise<WebSocket>((resolve, reject) => {
          // Node's WebSocket (undici) takes request headers; a browser's sets Origin itself.
          const socket = new WebSocket(`ws://127.0.0.1:${port}/`, { protocols: ['vite-hmr'], headers: { Origin: origin } } as never);
          socket.onopen = () => resolve(socket);
          socket.onerror = () => reject(new Error(`refused: ${origin}`));
        });
      try {
        await wxt.start();
        await expect(open(EVIL)).rejects.toThrow(`refused: ${EVIL}`);
        const worker = await open(EXTENSION);
        const reload = new Promise<{ data: unknown }>((resolve) => {
          worker.onmessage = ({ data }) => {
            const message = JSON.parse(String(data));
            if (message.event === 'wxt:reload-content-script') resolve(message);
          };
        });
        worker.send(JSON.stringify({ type: 'custom', event: 'wxt:background-initialized' }));
        expect((await reload).data).toMatchObject({ contentScript: { js: ['content-scripts/auth-bridge.js'] } });
        worker.close();
      } finally {
        await wxt.stop();
        await cleanup();
        await rm(outDir, { recursive: true, force: true });
      }
    },
    TIMEOUT * 2,
  );
});

describe('isLoopbackHostHeader', () => {
  it.each([
    ['localhost:3000', true],
    ['LOCALHOST:3000', true],
    ['127.0.0.1:3000', true],
    ['127.0.0.2:3000', true],
    ['[::1]:3000', true],
    ['localhost:3001', false],
    ['localhost', false],
    ['localhost.:3000', false],
    ['127.1:3000', false],
    ['0.0.0.0:3000', false],
    ['[::ffff:7f00:1]:3000', false],
    ['[::ffff:127.0.0.1]:3000', false],
    ['[0:0:0:0:0:0:0:1]:3000', false],
    ['evil.example:3000', false],
    ['evil@localhost:3000', false],
    ['localhost:3000/x', false],
    ['', false],
    [undefined, false],
  ])('%j -> %s', (host, expected) => {
    expect(isLoopbackHostHeader(host, 3000)).toBe(expected);
  });
});

describe('devBoundary', () => {
  it('owns localhost and the bound literal only, and server.origin on its own host and port', () => {
    const v4 = devBoundary({ address: '127.0.0.1', port: 3000 }, 'http://dev.test:4000', () => {});
    expect(v4 && [...v4.own]).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://dev.test:4000']);
    expect(v4 && [...v4.configuredHosts]).toEqual(['dev.test:4000']);
    const v6 = devBoundary({ address: '::1', port: 3000 }, 'https://dev.test', () => {});
    expect(v6 && [...v6.own]).toEqual(['http://localhost:3000', 'http://[::1]:3000', 'https://dev.test']);
    expect(v6 && [...v6.configuredHosts]).toEqual(['dev.test:443', 'dev.test']);
    expect(devBoundary(null, undefined, () => {})).toBeNull();
    expect(devBoundary('/tmp/pipe', undefined, () => {})).toBeNull();
  });

  it.each(['http://::1', 'dev.test:4000', 'not an origin'])('ignores server.origin %j, with one warning', (configured) => {
    const warn = vi.fn();
    const boundary = devBoundary({ address: '127.0.0.1', port: 3000 }, configured, warn);
    expect(boundary && [...boundary.own]).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    expect(boundary && admits(boundary, 'localhost:3000', 'null', undefined)).toBe(false);
    expect(warn.mock.calls).toEqual([[expect.stringMatching(/Ignoring server\.origin .*faultmaven#2863/)]]);
  });
});

describe('isLoopbackHost', () => {
  it.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['127.1.2.3', true],
    ['::1', true],
    ['0:0:0:0:0:0:0:1', true],
    ['[::1]', false],
    ['0.0.0.0', false],
    ['::', false],
    ['localhost.example.com', false],
    ['127.0.0.1.nip.io', false],
    ['', false],
    [true, false],
    [2130706433, false],
  ])('%j -> %s', (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });
});
