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
import { createServer, isFileLoadingAllowed, type ViteDevServer } from 'vite';

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

/**
 * A GET of a raw path over node:http: the suite's setup replaces `fetch` with a
 * mock, and a URL parser would normalize a `%2e%2e` segment away.
 */
function get(port: number, urlPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    httpGet({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

/** Starts the playground from its real config on a free loopback port. */
async function withPlayground(run: (server: ViteDevServer, port: number) => Promise<void>) {
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
    await run(server, (server.httpServer?.address() as AddressInfo).port);
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
    withPlayground(async (_, port) => {
      const missing: string[] = [];
      for (const [url, sentinel] of [
        ['/index.html', '<div id="root">'],
        ['/main.tsx', 'webHostAdapter'],
        [`/@fs${repoRoot}/packages/copilot-ui/index.ts`, 'setHostStore'],
        [`/@fs${repoRoot}/node_modules/react/index.js`, 'react.production'],
        ['/icon/square-transparent.svg', '<svg'],
      ]) {
        const res = await get(port, url);
        // The SPA fallback answers 200 for any path, so the body is the check.
        if (res.status !== 200 || !res.body.includes(sentinel)) missing.push(`${res.status} ${url}`);
      }
      expect(missing).toEqual([]);
    }));

  it('refuses every other file in the checkout (fm#2630)', () =>
    withPlayground(async (server, port) => {
      const status: Record<string, number> = {};
      const leaked: string[] = [];
      for (const [file, sentinel] of [
        ['.claude/rules/credential-chain.md', 'src/extension/auth'],
        ['package.json', '"scripts"'],
        ['.env.example', 'Environment Configuration'],
      ]) {
        // The root is playground/: sirv confines a root-relative path to it, so a
        // traversal gets the SPA page at worst, and only /@fs/ reaches the checkout.
        const res = await get(port, `/%2e%2e/${file}?raw`);
        if (res.body.includes(sentinel)) leaked.push(`/%2e%2e/${file}?raw`);
        if (res.status !== 403) expect(res.body).toContain('<div id="root">');
        for (const query of ['', '?raw', '?import', '?url']) {
          const url = `/@fs${repoRoot}/${file}${query}`;
          const res = await get(port, url);
          status[url] = res.status;
          if (res.body.includes(sentinel)) leaked.push(url);
        }
      }
      expect(status).toEqual(Object.fromEntries(Object.keys(status).map((url) => [url, 403])));
      expect(leaked).toEqual([]);
      // A tool cache is denied whether or not a file exists there to request (an
      // absent one gets the SPA page); the dependency cache beside it is served.
      const modules = join(repoRoot, 'node_modules');
      expect(isFileLoadingAllowed(server.config, `${modules}/.cache/jiti/probe.mjs`)).toBe(false);
      expect(isFileLoadingAllowed(server.config, `${modules}/.vite/deps/probe.js`)).toBe(true);
    }));
});
