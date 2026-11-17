// @vitest-environment node
/**
 * `pnpm dev` is `wxt`, and `wxt --host <addr>` opens its Vite server to the
 * network. WXT roots that server at the checkout, so what the opt-in exposes is
 * `fs.allow` (fm#2662, the twin of the playground's fm#2630): the extension's
 * sources, the workspace UI package and `node_modules`, and no other file in
 * the checkout. The server is WXT's own, from its real final config; the same
 * `vite` factory also feeds WXT's entrypoint importer, so `build`, `zip` and
 * `prepare` must still load every entrypoint under the list.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isFileLoadingAllowed, resolveConfig, type InlineConfig, type ViteDevServer } from 'vite';
import { createServer as createWxtServer, prepare, type Logger } from 'wxt';

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

/** A GET of a raw path over node:http: the suite's setup replaces `fetch` with a mock. */
function get(port: number, urlPath: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    httpGet({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

const quiet: Logger = {
  debug() {}, log() {}, info() {}, warn() {}, error() {}, fatal() {}, success() {}, level: 0,
};

/**
 * Starts WXT's own dev-server Vite instance on a free loopback port. The config
 * is the one WXT hands Vite (`vite:devServer:extendConfig` runs last, after
 * WXT merged its plugins and server options into the `vite` factory's output);
 * the test only adds a scratch cache, no dependency scan and no warm-up, so the
 * run shares nothing with a live `pnpm dev` and no request races close().
 */
async function withWxtDevServer(run: (server: ViteDevServer, port: number) => Promise<void>) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'wxt-dev-fs-allow-'));
  let vite: ViteDevServer | undefined;
  const wxt = await createWxtServer({
    root: repoRoot,
    logger: quiet,
    webExt: { disabled: true },
    dev: { server: { host: '127.0.0.1', port: await freePort() } },
    hooks: {
      'vite:devServer:extendConfig': (config: InlineConfig) => {
        config.cacheDir = cacheDir;
        config.optimizeDeps = { ...config.optimizeDeps, noDiscovery: true, include: [] };
        config.server = { ...config.server, preTransformRequests: false };
        config.plugins = [...(config.plugins ?? []), { name: 'capture-server', configureServer: (s) => void (vite = s) }];
      },
    },
  });
  try {
    if (!vite) throw new Error('WXT created no Vite server');
    await vite.listen();
    await run(vite, (vite.httpServer?.address() as AddressInfo).port);
  } finally {
    await wxt.stop();
    await rm(cacheDir, { recursive: true, force: true });
  }
}

describe('pnpm dev', () => {
  it('passes no --host in the scripts or the config', async () => {
    const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
    // A bare `--host`, `--host <value>` or `--host=<value>`.
    for (const script of ['dev', 'dev:firefox']) expect(pkg.scripts[script]).not.toMatch(/(^|\s)--host(\s|=|$)/);
    const wxtConfig = await readFile(join(repoRoot, 'wxt.config.ts'), 'utf8');
    // No `dev:` block, so no `dev.server.host`, and no `host:` key anywhere.
    expect(wxtConfig).not.toMatch(/^\s*(dev|host)\s*:/m);
  });

  it('refuses every other file in the checkout (fm#2662)', () =>
    withWxtDevServer(async (server, port) => {
      const status: Record<string, number> = {};
      const leaked: string[] = [];
      // Tracked files only, so the probe means the same thing in every checkout.
      for (const [file, sentinel] of [
        ['pnpm-lock.yaml', 'lockfileVersion'],
        ['wxt.config.ts', 'defineConfig'],
        ['package.json', '"scripts"'],
        ['.claude/rules/credential-chain.md', 'src/extension/auth'],
        ['.env.example', 'Environment Configuration'],
      ]) {
        // The root is the checkout, so a peer asks root-relative; /@fs/ is the absolute form.
        for (const base of [`/${file}`, `/@fs${repoRoot}/${file}`]) {
          for (const query of ['', '?raw', '?url', '?import']) {
            const url = base + query;
            const res = await get(port, url);
            status[url] = res.status;
            if (res.body.toString('utf8').includes(sentinel)) leaked.push(url);
          }
        }
      }
      expect(leaked).toEqual([]);
      expect(status).toEqual(Object.fromEntries(Object.keys(status).map((url) => [url, 403])));
      // A tool cache is denied whether or not a file exists there; the dependency cache is served.
      const modules = join(repoRoot, 'node_modules');
      expect(isFileLoadingAllowed(server.config, `${modules}/.cache/jiti/probe.mjs`)).toBe(false);
      expect(isFileLoadingAllowed(server.config, `${modules}/.vite/deps/probe.js`)).toBe(true);
      // An explicit deny replaces Vite's default, so a default a later Vite adds must be copied in.
      const viteDefault = (await resolveConfig({ configFile: false, root: repoRoot, logLevel: 'silent' }, 'serve'))
        .server.fs.deny;
      expect(server.config.server.fs.deny).toEqual(expect.arrayContaining(viteDefault));
    }));

  it('serves every module the HTML entrypoints load, and what WXT injects into them', () =>
    withWxtDevServer(async (server, port) => {
      // The module graph of both pages, from their entry scripts. A dependency's
      // own imports resolve inside node_modules (pnpm's store is node_modules/.pnpm),
      // so the walk checks the dependency it reaches and does not descend into it.
      // A stylesheet's graph edges are not requests: Vite inlines its @imports, and
      // the rest are PostCSS watch files (tailwind.config.cjs, refused like any
      // other config). What a stylesheet makes the page fetch is its url()s.
      // Vite also admits any file a served module imports (its safeModulePaths),
      // so the fetches below are what a list without node_modules breaks.
      const refused: string[] = [];
      const cssUrls = new Set<string>();
      const seen = new Set<string>();
      const queue = ['/src/entrypoints/sidepanel_manual/main.tsx', '/src/entrypoints/options/main.tsx'];
      while (queue.length > 0) {
        const url = queue.shift()!;
        if (seen.has(url)) continue;
        seen.add(url);
        const result = await server.transformRequest(url);
        const mod = await server.moduleGraph.getModuleByUrl(url);
        if (!mod) throw new Error(`not in the module graph: ${url}`);
        if (mod.file && !isFileLoadingAllowed(server.config, mod.file)) refused.push(mod.file);
        if (/\.css($|\?)/.test(url)) {
          for (const [, ref] of result?.code.matchAll(/url\(([^)'"]+)\)/g) ?? []) cssUrls.add(new URL(ref).pathname);
          continue;
        }
        if (mod.file?.includes('/node_modules/')) continue;
        for (const dep of mod.importedModules) queue.push(dep.url);
      }
      expect(refused).toEqual([]);
      // The graph reached the shared UI package and the fonts its stylesheet loads.
      expect([...seen].some((url) => url.startsWith('/packages/copilot-ui/'))).toBe(true);
      expect([...cssUrls].some((url) => url.includes('/@fontsource/'))).toBe(true);
      const unserved: string[] = [];
      for (const url of cssUrls) if ((await get(port, url)).status !== 200) unserved.push(url);
      expect(unserved).toEqual([]);

      const missing: string[] = [];
      for (const [url, sentinel] of [
        ['/@vite/client', 'createHotContext'],
        // The reloader WXT adds to each page (`@wxt/reload-html`, an alias to this file).
        [`/@fs${repoRoot}/node_modules/wxt/dist/virtual/reload-html.mjs`, 'getDevServerWebSocket'],
        [`/@fs${repoRoot}/node_modules/react/index.js`, 'react.production'],
        ['/icon/px16-square-dark.png', '\x89PNG'],
      ]) {
        const res = await get(port, url);
        if (res.status !== 200 || !res.body.toString('latin1').includes(sentinel)) missing.push(`${res.status} ${url}`);
      }
      expect(missing).toEqual([]);
    }), 120_000);

  it("imports every scripted entrypoint through WXT's build-time importer", async () => {
    // `build`, `zip` and `prepare` load each entrypoint's options through a Vite
    // server made from the same `vite` factory, so the list gates them too.
    let names: string[] = [];
    await prepare({
      root: repoRoot,
      logger: quiet,
      hooks: { 'entrypoints:resolved': (_, entrypoints) => void (names = entrypoints.map((e) => e.name)) },
    });
    expect(names).toEqual(expect.arrayContaining(['background', 'auth-bridge', 'sidepanel_manual', 'options']));
  });
});
