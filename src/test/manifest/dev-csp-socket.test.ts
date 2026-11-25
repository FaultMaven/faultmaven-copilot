import { describe, it, expect, vi } from 'vitest';
import { withDevServerSocket } from '../../../dev-csp';
// WXT's own derivation of the URL its reload clients dial (`__DEV_SERVER_ORIGIN__`).
// Not a package export, so it is read from the file the dev build runs.
import { devServerGlobals } from '../../../node_modules/wxt/dist/core/builders/vite/plugins/devServerGlobals';

// Stub `wxt` as src/test/support/manifest.ts explains: the config is under
// test, the bundler is not.
vi.mock('wxt', () => ({ defineConfig: (config: unknown) => config }));

/**
 * `pnpm dev` connects to the dev server over a WebSocket, which the
 * extension-pages `connect-src` (`'self' http: https:`) does not admit, so
 * there was no HMR and no content-script reload (fm#2871). The dev build adds
 * exactly the configured dev server origin's WebSocket source; a build's CSP
 * stays byte-identical.
 */

const PROD = "script-src 'self'; object-src 'self'; connect-src 'self' http: https:;";
// What WXT hands `build:manifestGenerated` in `serve`: `addDevModeCsp` has
// added the origin to `script-src` and written a `sandbox` CSP.
const SERVE_CSP = "script-src 'self' http://localhost:3000; object-src 'self'; connect-src 'self' http: https:;";
const SANDBOX = "script-src 'self' http://localhost:3000; sandbox allow-scripts allow-forms allow-popups allow-modals; child-src 'self';";

type Hook = (wxt: unknown, manifest: { content_security_policy?: { extension_pages?: string; sandbox?: string } }) => void;

async function hooks(): Promise<Record<string, unknown>> {
  vi.resetModules();
  const config = (await import('../../../wxt.config')).default as { hooks: Record<string, unknown> };
  return config.hooks;
}

async function runHook(command: 'serve' | 'build', origin: string | undefined, extensionPages = SERVE_CSP) {
  const manifest = { content_security_policy: { extension_pages: extensionPages, sandbox: SANDBOX } };
  const hook = (await hooks())['build:manifestGenerated'] as Hook;
  hook({ config: { command }, server: origin === undefined ? undefined : { origin } }, manifest);
  return manifest.content_security_policy;
}

/** The `__DEV_SERVER_ORIGIN__` WXT defines in `serve` for a server at `origin`. */
function wxtDialled(origin: string): string {
  const plugin = devServerGlobals({ command: 'serve' } as Parameters<typeof devServerGlobals>[0], { origin } as Parameters<typeof devServerGlobals>[1]);
  const config = plugin.config as () => { define: Record<string, string> };
  return config().define.__DEV_SERVER_ORIGIN__;
}

const connectSrc = (csp: string) =>
  csp.split(';').map((d) => d.trim().split(/\s+/)).find(([name]) => name === 'connect-src')?.slice(1);

describe('withDevServerSocket', () => {
  it('appends the ws: source of an http: origin to connect-src', () => {
    expect(withDevServerSocket(PROD, 'http://localhost:3000')).toBe(
      "script-src 'self'; object-src 'self'; connect-src 'self' http: https: ws://localhost:3000;",
    );
  });

  it('maps https: to wss:, and a default port to none', () => {
    expect(connectSrc(withDevServerSocket(PROD, 'https://dev.example:8443'))).toContain('wss://dev.example:8443');
    expect(connectSrc(withDevServerSocket(PROD, 'https://dev.example:443'))).toEqual(["'self'", 'http:', 'https:', 'wss://dev.example']);
  });

  it('adds connect-src to a CSP without one', () => {
    expect(withDevServerSocket("script-src 'self';", 'http://localhost:3000')).toBe("script-src 'self'; connect-src ws://localhost:3000;");
    expect(withDevServerSocket("script-src 'self'", 'http://localhost:3000')).toBe("script-src 'self'; connect-src ws://localhost:3000");
  });

  it('is idempotent', () => {
    const once = withDevServerSocket(PROD, 'http://localhost:3000');
    expect(withDevServerSocket(once, 'http://localhost:3000')).toBe(once);
  });

  it('returns the CSP unchanged for an unparseable or non-http(s) origin', () => {
    for (const origin of ['', 'localhost:3000x', 'not a url', 'ws://localhost:3000', 'file:///tmp', 'chrome-extension://abc']) {
      expect(withDevServerSocket(PROD, origin), origin).toBe(PROD);
    }
  });
});

describe("wxt.config.ts's build:manifestGenerated hook", () => {
  it('keeps the config:resolved loopback gate beside it', async () => {
    expect(typeof (await hooks())['config:resolved']).toBe('function');
  });

  it('in serve, adds the dev server socket to connect-src only', async () => {
    const csp = await runHook('serve', 'http://localhost:3000');
    expect(csp.extension_pages).toBe(
      "script-src 'self' http://localhost:3000; object-src 'self'; connect-src 'self' http: https: ws://localhost:3000;",
    );
    expect(csp.sandbox).toBe(SANDBOX);
  });

  it('in build, leaves the CSP byte-identical', async () => {
    const csp = await runHook('build', 'http://localhost:3000', PROD);
    expect(csp.extension_pages).toBe(PROD);
    expect(csp.sandbox).toBe(SANDBOX);
  });

  it('in serve with no server origin (WxtVitest), leaves the CSP unchanged', async () => {
    expect((await runHook('serve', undefined)).extension_pages).toBe(SERVE_CSP);
  });

  it('admits the origin WXT dials', async () => {
    for (const origin of ['http://localhost:3000', 'https://dev.example:443', 'https://dev.example:8443']) {
      const before = connectSrc(SERVE_CSP) ?? [];
      const admitted = connectSrc((await runHook('serve', origin)).extension_pages ?? '')?.filter((v) => !before.includes(v));
      const dialled = JSON.parse(wxtDialled(origin)) as string;
      // The WebSocket constructor maps http: to ws: and https: to wss: (WHATWG).
      const url = new URL(dialled.replace(/^http(s?):/, 'ws$1:'));
      expect(admitted, origin).toEqual([url.origin]);
    }
  });
});
