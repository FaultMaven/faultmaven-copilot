// @vitest-environment node
/**
 * `pnpm playground` listens on loopback only (fm#2425), and `--host` is the
 * opt-in to the LAN. The command is the script plus the config, so both are
 * pinned: the script passes no `--host`, and the server the config starts binds
 * the literal `127.0.0.1`. What the opt-in exposes is pinned too (fm#2630):
 * `fs.allow` is the playground, the package and `node_modules`, so the server
 * answers for those and refuses every other file in the checkout.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';

/** An OS-assigned free port, picked as playwright.config.ts picks one. */
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

const repoRoot = process.cwd();

/** A GET over node:http, since the suite's setup replaces `fetch` with a mock. */
function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    httpGet(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

/** Starts the playground from its real config on a free loopback port. */
async function withPlayground(run: (server: ViteDevServer, origin: string) => Promise<void>) {
  // A scratch cache and no dependency scan: the run leaves nothing in
  // node_modules/.vite and shares no cache with a live playground.
  const cacheDir = await mkdtemp(join(tmpdir(), 'playground-bind-'));
  let server: ViteDevServer | undefined;
  try {
    server = await createServer({
      configFile: join(repoRoot, 'playground/vite.config.ts'),
      cacheDir,
      optimizeDeps: { noDiscovery: true, include: [] },
      // No warm-up: a module request must not start a graph walk that races close().
      server: { port: await freePort(), preTransformRequests: false },
      logLevel: 'silent',
    });
    await server.listen();
    await run(server, `http://127.0.0.1:${(server.httpServer?.address() as AddressInfo).port}`);
  } finally {
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
}

describe('pnpm playground', () => {
  it('passes no --host in the script', async () => {
    const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
    // A bare `--host`, `--host <value>` or `--host=<value>`.
    expect(pkg.scripts.playground).not.toMatch(/(^|\s)--host(\s|=|$)/);
  });

  it('binds 127.0.0.1, not every interface', () =>
    withPlayground(async (server) => {
      expect((server.httpServer?.address() as AddressInfo).address).toBe('127.0.0.1');
    }));

  it('serves the playground, the package, its dependencies and the public icons', () =>
    withPlayground(async (_, origin) => {
      for (const [url, sentinel] of [
        ['/index.html', '<div id="root">'],
        ['/main.tsx', 'webHostAdapter'],
        [`/@fs${repoRoot}/packages/copilot-ui/index.ts`, 'setHostStore'],
        [`/@fs${repoRoot}/node_modules/react/index.js`, 'react.production'],
        ['/icon/square-transparent.svg', '<svg'],
      ]) {
        const res = await get(origin + url);
        expect(res.status, url).toBe(200);
        // The SPA fallback answers 200 for any path, so the body is the check.
        expect(res.body, url).toContain(sentinel);
      }
    }));

  it('refuses every other file in the checkout (fm#2630)', () =>
    withPlayground(async (_, origin) => {
      // The root is playground/, so only /@fs/ reaches the rest of the checkout.
      for (const [file, sentinel] of [
        ['.claude/rules/credential-chain.md', 'src/extension/auth'],
        ['package.json', '"scripts"'],
        ['.env.example', 'Environment Configuration'],
      ]) {
        for (const url of [`/@fs${repoRoot}/${file}`, `/@fs${repoRoot}/${file}?raw`]) {
          const res = await get(origin + url);
          expect(res.status, url).toBe(403);
          expect(res.body, url).not.toContain(sentinel);
        }
      }
    }));
});
