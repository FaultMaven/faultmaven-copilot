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
 * off-loopback. Every server here is WXT's own, from the checkout's config,
 * on loopback.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InlineConfig, ViteDevServer } from 'vite';
import { createServer as createWxtServer, type InlineConfig as WxtInlineConfig, type Logger } from 'wxt';
import { isLoopbackHost } from '../../../wxt.config';

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
}

/**
 * WXT's own dev server from the checkout's config, with `dev.server.host` set
 * and an explicit port. That is not the CLI path: without `--port`, WXT's
 * `getPort` probe-binds the host before any hook runs, and a host this machine
 * does not own fails closed there, in WXT. The test adds only a scratch cache,
 * no dependency scan and no warm-up.
 */
async function startWxt(host: unknown, { onVite = () => {}, extend = () => {}, hooks = {} }: StartOptions = {}) {
  const port = await freePort();
  const cacheDir = await mkdtemp(join(tmpdir(), 'wxt-dev-loopback-'));
  try {
    const wxt = await createWxtServer({
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

async function withLoopbackServer(run: (vite: ViteDevServer, port: number) => Promise<void>) {
  let vite: ViteDevServer | undefined;
  const { wxt, port, cleanup } = await startWxt('127.0.0.1', { onVite: (s) => void (vite = s) });
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
