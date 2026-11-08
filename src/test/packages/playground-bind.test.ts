// @vitest-environment node
/**
 * `pnpm playground` listens on loopback only (fm#2425): with `fs.allow` at the
 * repo root, a LAN bind leaves `fs.deny` alone between the network and `.env`.
 * The command is the script plus the config, so both are pinned: the script
 * passes no `--host`, and the server the config starts binds the literal
 * `127.0.0.1`. `pnpm playground --host` is the opt-in.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

describe('pnpm playground', () => {
  it('passes no --host in the script', async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
    // A bare `--host`, `--host <value>` or `--host=<value>`.
    expect(pkg.scripts.playground).not.toMatch(/(^|\s)--host(\s|=|$)/);
  });

  it('binds 127.0.0.1, not every interface', async () => {
    // A scratch cache and no dependency scan: the run leaves nothing in
    // node_modules/.vite and shares no cache with a live playground.
    const cacheDir = await mkdtemp(join(tmpdir(), 'playground-bind-'));
    let server: ViteDevServer | undefined;
    try {
      server = await createServer({
        configFile: join(process.cwd(), 'playground/vite.config.ts'),
        cacheDir,
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { port: await freePort() },
        logLevel: 'silent',
      });
      await server.listen();
      expect((server.httpServer?.address() as AddressInfo).address).toBe('127.0.0.1');
    } finally {
      await server?.close();
      await rm(cacheDir, { recursive: true, force: true });
    }
  });
});
