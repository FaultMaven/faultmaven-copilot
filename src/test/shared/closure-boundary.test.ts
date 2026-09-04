/**
 * What the shared tree is allowed to depend on, checked against the tree.
 *
 * `src/shared` is what a second host consumes, and what it consumes is not the
 * directory — it is the directory's IMPORT CLOSURE. A component that imports one
 * clean-looking module which imports `browser.storage` three levels down is just
 * as unusable in a web page as one that calls it directly, and no per-file
 * review catches that. So the closure is COMPUTED here, never hand-listed: a
 * list would go stale the first time someone added an import.
 *
 * Two kinds of assertion, deliberately different in strength:
 *
 *   HARD ZERO   — for what has actually been eliminated. The shared closure
 *                 holds no token storage key and performs no token refresh.
 *                 These can never come back.
 *
 *   RATCHET     — for `browser.*`, which is mid-migration. The offender set is
 *                 recorded below and must match EXACTLY: a new violation fails,
 *                 and so does a file that gets cleaned without being struck off,
 *                 so the list can only shrink and cannot quietly drift.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath, dirname } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

function resolveSpec(spec: string, from: string): string | null {
  let p: string;
  if (spec.startsWith('~/')) p = join(SRC, spec.slice(2));
  else if (spec.startsWith('~lib/')) p = join(SRC, 'lib', spec.slice(5));
  else if (spec.startsWith('.')) p = resolvePath(dirname(from), spec);
  else return null; // a package, not our source
  for (const c of [`${p}.ts`, `${p}.tsx`, join(p, 'index.ts'), join(p, 'index.tsx'), p]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) filesUnder(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

function importClosure(roots: string[]): string[] {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    const re =
      /(?:^|[\s;{(])(?:import|export)[\s\S]{0,200}?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const r = resolveSpec(m[1] ?? m[2], f);
      if (r) stack.push(r);
    }
  }
  return [...seen].map((f) => relative(ROOT, f)).sort();
}

/**
 * Files in the closure that still reach an extension API.
 *
 * Every entry is a module the Dashboard cannot run today. They come off this
 * list as they move behind the host; the list is the remaining work, in one
 * place, rather than a number in a report nobody re-derives.
 */
const BROWSER_API_RATCHET = [
  'src/lib/api/services/auth-service.ts',
  'src/lib/auth/auth-config.ts',
  'src/lib/auth/auth-manager.ts',
  'src/lib/auth/token-manager.ts',
  'src/lib/utils/messaging.ts', // runtime messaging, not storage — needs its own capability
  'src/lib/utils/persistence-manager.ts', // storage half done; runtime.id/getManifest remain
].sort();

describe('the shared closure', () => {
  const closure = importClosure(filesUnder(join(SRC, 'shared')));
  const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  // Guards the guard. A resolver that stopped resolving would return a handful
  // of files and every assertion below would pass having checked almost nothing.
  it('is computed, and is not trivially small', () => {
    expect(closure.length).toBeGreaterThan(90);
    expect(closure).toContain('src/shared/ui/CopilotPanel.tsx');
    expect(closure).toContain('src/lib/api/client.ts');
  });

  // The extension's own host implementation must not be inside what the
  // Dashboard consumes — it would be relocated along with it.
  it('does not contain the extension host implementation', () => {
    expect(closure.filter((f) => f.includes('extension'))).toEqual([]);
  });

  // The request path — the files that BUILD and ISSUE every call the shared UI
  // makes. This is what this step converted, so it is a HARD ZERO, not a
  // ratchet: these three hold no credential and renew nothing, ever again.
  it('handles no credential on the request path', () => {
    const requestPath = [
      'src/lib/api/client.ts',
      'src/lib/api/fetch-utils.ts',
      'src/lib/api/transport.ts',
    ];
    // Every one of them must actually be in the closure, or this checks nothing.
    for (const f of requestPath) expect(closure).toContain(f);
    const apiLayer = requestPath;

    const pattern =
      /['"]authState['"]|\brefresh_token\b|getValidAccessToken|refreshAccessToken|faultmaven-token-refresh/;
    const hits = apiLayer.filter((f) => pattern.test(read(f)) && !f.endsWith('api.generated.ts'));
    expect(
      hits,
      `The request path must obtain a bearer from the host and nothing else:\n${hits.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * The extension's credential stack, still reachable from the shared tree
   * through the `lib/api` barrel and through `config.ts`'s dynamic import.
   *
   * Same exact-match discipline as the extension-API ratchet: a new route in
   * fails, and severing one of these without striking it off fails too.
   */
  it('reaches the credential stack only through the routes still to be cut', () => {
    const pattern =
      /['"]authState['"]|\brefresh_token\b|getValidAccessToken|refreshAccessToken|faultmaven-token-refresh/;
    const actual = closure
      .filter((f) => pattern.test(read(f)) && !f.endsWith('api.generated.ts'))
      .sort();
    const expected = [
      'src/lib/api/services/auth-service.ts', // the extension's logout/revocation, via the lib/api barrel
      'src/lib/auth/auth-config.ts', // via config.ts's dynamic import
      'src/lib/auth/auth-manager.ts', // via the lib/api barrel
      'src/lib/auth/token-manager.ts', // via auth-manager
      // Names the key, never reads the value: it WATCHES for `authState` being
      // cleared in another context. Observing a credential's disappearance is
      // not holding one, and this stays after the stack above is cut.
      'src/lib/state/slices/auth-slice.ts',
    ].sort();

    const added = actual.filter((f) => !expected.includes(f));
    const cut = expected.filter((f) => !actual.includes(f));
    expect(added, `NEW credential dependency in the shared closure:\n${added.join('\n')}`).toEqual([]);
    expect(cut, `No longer reachable — strike it off:\n${cut.join('\n')}`).toEqual([]);
  });

  it('reaches extension APIs only from the files still awaiting migration', () => {
    const actual = closure.filter((f) => /\b(?:browser|chrome)\./.test(read(f))).sort();

    const added = actual.filter((f) => !BROWSER_API_RATCHET.includes(f));
    const fixed = BROWSER_API_RATCHET.filter((f) => !actual.includes(f));

    expect(
      added,
      `NEW extension-API dependency in the shared closure. Route it through the ` +
        `host adapter — a web page has no \`browser\`:\n${added.join('\n')}`,
    ).toEqual([]);
    expect(
      fixed,
      `These no longer reach an extension API. Strike them off ` +
        `BROWSER_API_RATCHET so the list keeps meaning what it says:\n${fixed.join('\n')}`,
    ).toEqual([]);
  });
});
