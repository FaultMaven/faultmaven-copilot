// @vitest-environment node
/**
 * `pnpm playground` is plain Vite, and it installs the origin boundary `wxt dev`
 * does (`dev-server-boundary.ts`, fm#2872), with the playground's own network
 * rule: loopback by default, the LAN by IP address on `--host`. Every server
 * here is Vite's real one from `playground/vite.config.ts`, bound to
 * 127.0.0.1; the LAN cases report a wildcard bind and send LAN `Host` strings
 * over loopback, so nothing leaves the machine.
 */
import { describe, it, expect, vi } from 'vitest';
import childProcess, { type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer as createNetServer, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { admits, devBoundary, ipHostOrigin, type DevServerBoundaryOptions } from '../../../dev-server-boundary';

const TIMEOUT = 60_000;
const configFile = join(process.cwd(), 'playground/vite.config.ts');
const PLAYGROUND: DevServerBoundaryOptions = { label: '[playground]', network: 'lan-opt-in', extensionOrigins: false };

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

/** The playground's dev server on loopback; `reportBind` makes `address()` report that bind instead (the real one stays). */
async function withPlayground(run: (vite: ViteDevServer, port: number) => Promise<void>, reportBind?: string) {
  const port = await freePort();
  const cacheDir = await mkdtemp(join(tmpdir(), 'playground-dev-boundary-'));
  const capture = {
    name: 'report-bind',
    configureServer(server: ViteDevServer) {
      const http = server.httpServer!;
      const real = http.address.bind(http);
      if (reportBind) vi.spyOn(http, 'address').mockImplementation(() => ({ ...(real() as AddressInfo), address: reportBind }));
    },
  };
  const vite = await createServer({
    configFile,
    cacheDir,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { port, strictPort: true, preTransformRequests: false, watch: null },
    plugins: [capture],
  });
  try {
    await vite.listen();
    await run(vite, port);
  } finally {
    await vite.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
}

/** A raw exchange over node:http: an answer's status (and its CORS grant), 101 for an upgrade, 'reset' for a destroyed socket. */
function send(port: number, path: string, headers: Record<string, string> = {}): Promise<[number | string, unknown?]> {
  return new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers }, (res) => {
      res.resume();
      resolve([res.statusCode ?? 0, res.headers['access-control-allow-origin']]);
    });
    req.on('upgrade', (_res, socket) => {
      socket.destroy();
      resolve([101]);
    });
    req.on('error', () => resolve(['reset']));
    req.end();
  });
}

const HMR = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Protocol': 'vite-hmr' };
const EXTENSION = 'chrome-extension://abc';
const OTHER_APP = 'http://localhost:3333';

/** Each row's status and spawn count on `/__open-in-editor`, with the editor stubbed to log its argument. */
async function editorOutcomes(port: number, rows: Record<string, Record<string, string>>) {
  const dir = await mkdtemp(join(tmpdir(), 'playground-editor-'));
  const editor = join(dir, 'editor.sh');
  await writeFile(editor, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${join(dir, 'log')}'\n`);
  await chmod(editor, 0o755);
  vi.stubEnv('LAUNCH_EDITOR', editor);
  const spawn = vi.spyOn(childProcess, 'spawn');
  try {
    const outcomes: Record<string, [number | string, number]> = {};
    for (const [label, headers] of Object.entries(rows)) {
      const before = spawn.mock.calls.length;
      // An existing file with a position, as the overlay sends: launch-editor skips a missing file.
      outcomes[label] = [(await send(port, '/__open-in-editor?file=package.json:1:1', headers))[0], spawn.mock.calls.length - before];
    }
    await Promise.all(spawn.mock.results.map(({ value }) => (value as ChildProcess).exitCode === null && once(value as ChildProcess, 'exit')));
    const lines = await readFile(join(dir, 'log'), 'utf8').then((log) => log.trim().split('\n').length, () => 0);
    return { outcomes, lines };
  } finally {
    spawn.mockRestore();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
}

/** Expected outcomes: `admitted` rows get `yes`, every other row `no`. */
const expected = <T>(rows: object, admitted: string[], yes: T, no: T) =>
  Object.fromEntries(Object.keys(rows).map((label) => [label, admitted.includes(label) ? yes : no]));

describe('the playground dev server refuses foreign origins (fm#2872)', () => {
  it(
    'serves its own origin and loopback tools, and refuses other pages and other localhost apps with no CORS grant',
    () =>
      withPlayground(async (_vite, port) => {
        const rows: Record<string, Record<string, string>> = {
          'another localhost app': { Origin: OTHER_APP },
          'an extension': { Origin: EXTENSION },
          'cross-site': { 'Sec-Fetch-Site': 'cross-site' },
          'Host 10.9.9.9': { Host: `10.9.9.9:${port}` },
          'Host evil.example': { Host: `evil.example:${port}` },
          'no headers': {},
          'same-origin': { 'Sec-Fetch-Site': 'same-origin' },
          'own 127.0.0.1': { Origin: `http://127.0.0.1:${port}` },
          'own localhost': { Origin: `http://localhost:${port}`, Host: `localhost:${port}` },
        };
        const admitted = ['no headers', 'same-origin', 'own 127.0.0.1', 'own localhost'];
        for (const path of ['/', '/@vite/client']) {
          const outcomes: Record<string, number | string> = {};
          for (const [label, headers] of Object.entries(rows)) {
            const [status, grant] = await send(port, path, headers);
            outcomes[label] = status;
            if (status === 403) expect({ label, grant }).toEqual({ label, grant: undefined });
          }
          expect(outcomes).toEqual(expected(rows, admitted, 200, 403));
        }
      }),
    TIMEOUT,
  );

  it(
    'admits an HMR upgrade only with its token from its own origin, and no vite-ping from a foreign one',
    () =>
      withPlayground(async (vite, port) => {
        const tokened = `/?token=${vite.config.webSocketToken}`;
        const rows: Record<string, [string, Record<string, string>]> = {
          'vite-ping from another app': ['/', { Origin: OTHER_APP, 'Sec-WebSocket-Protocol': 'vite-ping' }],
          'tokened, another app': [tokened, { Origin: OTHER_APP }],
          'tokened, Host 10.9.9.9': [tokened, { Origin: `http://10.9.9.9:${port}`, Host: `10.9.9.9:${port}` }],
          'tokenless, own origin': ['/', { Origin: `http://127.0.0.1:${port}` }],
          'tokened, own 127.0.0.1': [tokened, { Origin: `http://127.0.0.1:${port}` }],
          'tokened, own localhost': [tokened, { Origin: `http://localhost:${port}`, Host: `localhost:${port}` }],
        };
        const outcomes: Record<string, number | string> = {};
        for (const [label, [path, headers]] of Object.entries(rows)) outcomes[label] = (await send(port, path, { ...HMR, ...headers }))[0];
        // Vite's own token check answers the tokenless one.
        expect(outcomes).toEqual({ ...expected<number | string>(rows, ['tokened, own 127.0.0.1', 'tokened, own localhost'], 101, 'reset'), 'tokenless, own origin': 400 });
      }),
    TIMEOUT,
  );

  it(
    'spawns the editor only for a loopback request from its own origin or no page, and logs each refusal',
    () =>
      withPlayground(async (vite, port) => {
        const warn = vi.spyOn(vite.config.logger, 'warn').mockImplementation(() => {});
        const rows: Record<string, Record<string, string>> = {
          'cross-site': { 'Sec-Fetch-Site': 'cross-site' },
          'same-site': { 'Sec-Fetch-Site': 'same-site' },
          'another localhost app': { Origin: OTHER_APP },
          'an extension': { Origin: EXTENSION },
          'Host 10.9.9.9': { Host: `10.9.9.9:${port}` },
          'no headers': {},
          none: { 'Sec-Fetch-Site': 'none' },
          'own origin': { Origin: `http://127.0.0.1:${port}` },
        };
        const admitted = ['no headers', 'none', 'own origin'];
        const { outcomes, lines } = await editorOutcomes(port, rows);
        expect(outcomes).toEqual(expected(rows, admitted, [200, 1], [403, 0]));
        expect(lines).toBe(admitted.length);
        const warnings = warn.mock.calls.map(([message]) => message);
        expect(warnings).toHaveLength(Object.keys(rows).length - admitted.length);
        expect(warnings.every((m) => m.startsWith('[playground] Refused a dev-server request') && m.includes("only the server's own origin reaches it"))).toBe(true);
      }),
    TIMEOUT,
  );

  it(
    'keeps the --host opt-in: no network guard, and a LAN Host by IP admitted with its own Origin only',
    () =>
      withPlayground(async (vite, port) => {
        const http = vite.httpServer!;
        expect((vite.middlewares.stack[0].handle as { name: string }).name).toBe('refuseForeignRequests');
        expect(http.listeners('connection').map((l) => l.name)).not.toContain('refuseNetworkSockets');
        expect(http.listeners('upgrade').map((l) => l.name)).not.toContain('refuseNetworkUpgrades');
        // Ahead of everything, a connection reports a LAN peer's address while `peer` is set.
        let peer: string | undefined = '192.168.0.5';
        http.prependListener('connection', (socket: Socket) => {
          if (peer) Object.defineProperty(socket, 'remoteAddress', { value: peer });
        });
        const lan = `192.0.2.10:${port}`;
        const rows: Record<string, Record<string, string>> = {
          'LAN Host, no headers': { Host: lan },
          'LAN Host, its Origin': { Host: lan, Origin: `http://${lan}` },
          'LAN Host, another IP Origin': { Host: lan, Origin: `http://192.0.2.11:${port}` },
          'LAN Host, another app': { Host: lan, Origin: OTHER_APP },
          'LAN Host, cross-site': { Host: lan, 'Sec-Fetch-Site': 'cross-site' },
          'LAN Host, other port': { Host: `192.0.2.10:${port + 1}` },
          'rebind.example': { Host: `rebind.example:${port}`, Origin: `http://rebind.example:${port}` },
        };
        const admitted = ['LAN Host, no headers', 'LAN Host, its Origin'];
        const outcomes: Record<string, number | string> = {};
        for (const [label, headers] of Object.entries(rows)) outcomes[label] = (await send(port, '/@vite/client', headers))[0];
        expect(outcomes).toEqual(expected(rows, admitted, 200, 403));
        const tokened = `/?token=${vite.config.webSocketToken}`;
        expect((await send(port, tokened, { ...HMR, Host: lan, Origin: `http://${lan}` }))[0]).toBe(101);
        // The editor: never for a LAN Host, nor for a loopback Host from a LAN peer.
        const editor = await editorOutcomes(port, { 'LAN Host': { Host: lan }, 'loopback Host': {} });
        expect(editor.outcomes).toEqual({ 'LAN Host': [403, 0], 'loopback Host': [403, 0] });
        // From loopback, under the wildcard bind, both loopback literals are own origins.
        peer = undefined;
        for (const host of [`127.0.0.1:${port}`, `[::1]:${port}`]) {
          expect([host, (await send(port, tokened, { ...HMR, Host: host, Origin: `http://${host}` }))[0]]).toEqual([host, 101]);
        }
      }, '::'),
    TIMEOUT,
  );
});

describe('devBoundary under the LAN opt-in', () => {
  const at = (address: string, options = PLAYGROUND) => devBoundary({ address, port: 3000 }, undefined, () => {}, options);
  const rows: Record<string, [string, string?, string?]> = {
    'LAN Host, no headers': ['192.0.2.10:3000'],
    'LAN Host, its Origin': ['192.0.2.10:3000', 'http://192.0.2.10:3000'],
    'IPv6 Host, its Origin': ['[FE80::1]:3000', 'http://[fe80::1]:3000'],
    '127.0.0.1, its Origin': ['127.0.0.1:3000', 'http://127.0.0.1:3000'],
    '[::1], its Origin': ['[::1]:3000', 'http://[::1]:3000'],
    'LAN Host, another IP Origin': ['192.0.2.10:3000', 'http://192.0.2.11:3000'],
    'LAN Host, an extension': ['192.0.2.10:3000', EXTENSION],
    'LAN Host, cross-site': ['192.0.2.10:3000', undefined, 'cross-site'],
    'LAN Host, other port': ['192.0.2.10:3001'],
    'a DNS name': ['rebind.example:3000', 'http://rebind.example:3000'],
  };
  const outcomes = (boundary: ReturnType<typeof at>) =>
    Object.fromEntries(Object.entries(rows).map(([label, [host, origin, site]]) => [label, admits(boundary, host, origin, site)]));
  const LAN = ['LAN Host, no headers', 'LAN Host, its Origin', 'IPv6 Host, its Origin', '127.0.0.1, its Origin', '[::1], its Origin'];

  it.each(['0.0.0.0', '::', '192.0.2.10'])('bound to %s, admits an IP-literal Host with its own Origin only', (address) => {
    expect(at(address)?.lan).toBe(true);
    expect(outcomes(at(address))).toEqual(expected(rows, LAN, true, false));
  });

  it('bound to loopback, or loopback-only, admits no LAN Host', () => {
    expect(outcomes(at('127.0.0.1'))).toEqual(expected(rows, ['127.0.0.1, its Origin'], true, false));
    const wxt = at('0.0.0.0', { ...PLAYGROUND, network: 'loopback-only' });
    expect(wxt?.lan).toBe(false);
    expect(outcomes(wxt)).toEqual(expected(rows, [], true, false));
  });

  it('admits an extension origin only when asked', () => {
    expect(admits(at('127.0.0.1'), '127.0.0.1:3000', EXTENSION, undefined)).toBe(false);
    expect(admits(devBoundary({ address: '127.0.0.1', port: 3000 }, undefined, () => {}), '127.0.0.1:3000', EXTENSION, undefined)).toBe(true);
  });

  it.each([
    ['192.0.2.10:3000', 'http://192.0.2.10:3000'],
    ['[0:0:0:0:0:0:0:1]:3000', 'http://[::1]:3000'],
    ['[1.2.3.4]:3000', null],
    ['127.1:3000', null],
    ['192.0.2.10', null],
    ['[fe80::1%eth0]:3000', null],
    [undefined, null],
  ])('ipHostOrigin(%j) -> %j', (host, origin) => {
    expect(ipHostOrigin(host, 3000)).toBe(origin);
  });
});
