// @vitest-environment node
/**
 * `pnpm playground` listens on loopback only (fm#2425): with `fs.allow` at the
 * repo root, a LAN bind leaves `fs.deny` alone between the network and `.env`.
 * Starts the real server from the real config and reads the address it bound,
 * so it holds however the host is spelled. `--host` is the opt-in.
 */
import { describe, it, expect } from 'vitest';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createServer } from 'vite';

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

describe('playground dev server', () => {
  it('binds 127.0.0.1, not every interface', async () => {
    const server = await createServer({
      configFile: join(process.cwd(), 'playground/vite.config.ts'),
      server: { port: await freePort() },
      logLevel: 'silent',
    });
    try {
      await server.listen();
      expect((server.httpServer?.address() as AddressInfo).address).toBe('127.0.0.1');
    } finally {
      await server.close();
    }
  });
});
