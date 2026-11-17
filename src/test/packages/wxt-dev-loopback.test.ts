// @vitest-environment node
/**
 * `pnpm dev` is `wxt`, and `wxt --host <addr>` binds its Vite server to the
 * network, where WXT and Vite trust every peer with every surface they expose
 * (fm#2662). `wxt.config.ts` keeps the server on loopback: its
 * `config:resolved` hook refuses a non-loopback host before the server
 * exists, and its plugin refuses a non-loopback peer's request and WebSocket
 * upgrade ahead of WXT and Vite, and closes a server found bound off-loopback.
 * Every server here is WXT's own, from the checkout's config, on loopback.
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InlineConfig, ViteDevServer } from 'vite';
import { createServer as createWxtServer, type Logger } from 'wxt';
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

/**
 * WXT's own dev server from the checkout's config, with `dev.server.host` set
 * and an explicit port, so WXT's `getPort` never probe-binds the host. The
 * test adds only a scratch cache, no dependency scan and no warm-up.
 */
async function startWxt(host: unknown, onVite: (server: ViteDevServer) => void = () => {}) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'wxt-dev-loopback-'));
  const port = await freePort();
  try {
    const wxt = await createWxtServer({
      root: repoRoot,
      logger: quiet,
      webExt: { disabled: true },
      dev: { server: { host: host as string, port } },
      hooks: {
        'vite:devServer:extendConfig': (config: InlineConfig) => {
          config.cacheDir = cacheDir;
          config.optimizeDeps = { ...config.optimizeDeps, noDiscovery: true, include: [] };
          config.server = { ...config.server, preTransformRequests: false };
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
  const { wxt, port, cleanup } = await startWxt('127.0.0.1', (s) => void (vite = s));
  try {
    if (!vite) throw new Error('WXT created no Vite server');
    await vite.listen();
    await run(vite, port);
  } finally {
    await wxt.stop();
    await cleanup();
  }
}

/** A raw request over node:http (the suite's setup replaces `fetch`); an upgrade resolves 101. */
function send(port: number, path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('upgrade', (_res, socket) => {
      socket.destroy();
      resolve(101);
    });
    req.on('error', reject);
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
      const outcome = await startWxt(host).then(
        async ({ wxt, cleanup }) => {
          await wxt.stop();
          await cleanup();
          return 'started';
        },
        (error: Error) => error.message,
      );
      expect(outcome).toMatch(/faultmaven#2662/);
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

  it(
    'closes a server found bound off-loopback',
    () =>
      withLoopbackServer(async (vite, port) => {
        const http = vite.httpServer!;
        const check = http.listeners('listening').find((fn) => fn.name === 'refuseOffLoopbackBind');
        expect(check).toBeDefined();
        const error = vi.spyOn(vite.config.logger, 'error').mockImplementation(() => {});
        // The bind a later `server.host` override or an off-loopback `localhost` would produce.
        vi.spyOn(http, 'address').mockReturnValue({ address: '0.0.0.0', family: 'IPv4', port });
        check!.call(http);
        expect(http.listening).toBe(false);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('faultmaven#2662'));
      }),
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
