/**
 * What the shared package is allowed to depend on, checked against the tree.
 *
 * `packages/copilot-ui` is what a second host consumes, and what it consumes is
 * not the directory — it is the directory's IMPORT CLOSURE. A component that
 * imports one clean-looking module which imports `browser.storage` three levels
 * down is just as unusable in a web page as one that calls it directly, and no
 * per-file review catches that. So the closure is COMPUTED here, never
 * hand-listed: a list would go stale the first time someone added an import.
 *
 * The package boundary makes one thing structural that the directory boundary
 * could not: a file OUTSIDE the package cannot be reached by a relative import
 * from inside it, so the closure can no longer grow by someone reaching back
 * into the extension. It can still grow by adding a dependency, which is what
 * the assertions below are for.
 *
 * The ratchets are GONE, and that is the point of this step. Through the
 * migration this file carried two exact-match lists — the files still reaching
 * an extension API, and the files still reaching the credential stack — which
 * could shrink and never grow. Both are empty now, so both are stated as what
 * they became: HARD ZEROS over the whole closure. There is no list left to add
 * an entry to.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve as resolvePath, dirname } from 'node:path';

const ROOT = process.cwd();
const PKG = join(ROOT, 'packages/copilot-ui');

function resolveSpec(spec: string, from: string): string | null {
  let p: string;
  // Relative only. The package has no path aliases — an alias would resolve
  // against the CONSUMER's config, so a package that used one would compile in
  // this repository and break in the Dashboard.
  if (spec.startsWith('.')) p = resolvePath(dirname(from), spec);
  else return null; // a dependency, not our source
  for (const c of [`${p}.ts`, `${p}.tsx`, join(p, 'index.ts'), join(p, 'index.tsx'), p]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function filesUnder(dir: string, out: string[] = [], skip: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (skip.includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) filesUnder(p, out, skip);
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

describe('the shared closure', () => {
  const closure = importClosure(filesUnder(PKG, [], ['node_modules', 'dist', 'public']));
  const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  // Guards the guard, and it has to come FIRST now that everything below is a
  // hard zero: a resolver that stopped resolving would return a handful of files
  // and every assertion after it would pass having checked almost nothing. The
  // zeros are only worth as much as the size assertion that precedes them.
  it('is computed, and is not trivially small', () => {
    expect(closure.length).toBeGreaterThan(90);
    expect(closure).toContain('packages/copilot-ui/shared/ui/CopilotPanel.tsx');
    expect(closure).toContain('packages/copilot-ui/lib/api/client.ts');
    expect(closure).toContain('packages/copilot-ui/lib/state/store.ts');
    expect(closure).toContain('packages/copilot-ui/lib/utils/persistence-manager.ts');
  });

  // The extension's own host implementation must not be inside what the
  // Dashboard consumes. Structural now — it lives outside the package — but
  // asserted anyway, because a `../../src/extension/...` import would compile.
  it('does not contain the extension host implementation', () => {
    expect(closure.filter((f) => !f.startsWith('packages/copilot-ui/'))).toEqual([]);
  });

  // The request path — the files that BUILD and ISSUE every call the shared UI
  // makes. This is what this step converted, so it is a HARD ZERO, not a
  // ratchet: these three hold no credential and renew nothing, ever again.
  it('handles no credential on the request path', () => {
    const requestPath = [
      'packages/copilot-ui/lib/api/client.ts',
      'packages/copilot-ui/lib/api/fetch-utils.ts',
      'packages/copilot-ui/lib/api/transport.ts',
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
   * The credential stack is out of reach, everywhere in the closure.
   *
   * Not "the request path" and not "the files we have got to yet": the whole
   * closure. The shared UI holds no token, names no token storage key and
   * renews nothing, so the two risks the spike named — a short-shaped write
   * clobbering the Dashboard's `authState`, and a second refresher racing the
   * host's outside its Web Lock — are unreachable rather than avoided.
   *
   * `auth-slice` was the last entry here and came off with the rest: it used to
   * NAME `authState` to watch for the key being cleared, and now learns the same
   * thing from `HostSession.subscribeAuthState` and a host-store subscription
   * over keys it is handed.
   */
  it('holds no credential, anywhere in the closure', () => {
    const pattern =
      /['"]authState['"]|\brefresh_token\b|getValidAccessToken|refreshAccessToken|faultmaven-token-refresh/;
    const hits = closure
      .filter((f) => pattern.test(read(f)) && !f.endsWith('api.generated.ts'))
      .sort();

    expect(
      hits,
      `The shared closure must not reach the credential stack. The host owns the ` +
        `token chain, its storage key and its rotation lock:\n${hits.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * No extension API, anywhere in the closure.
   *
   * This was a ratchet of nine files for four steps. It is a hard zero now, and
   * the difference matters: a ratchet says "no NEW violations", which a reviewer
   * has to trust a list for, while this says the shared tree runs in a web page
   * — the property the whole boundary exists to produce.
   */
  it('reaches no extension API, anywhere in the closure', () => {
    const hits = closure.filter((f) => /\b(?:browser|chrome)\./.test(read(f))).sort();

    expect(
      hits,
      `Extension API in the shared closure. Route it through the host adapter — ` +
        `a web page has no \`browser\`:\n${hits.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * And no runtime messaging, which is the same fact one level down: `EventBus`
   * is the extension's transport, so a shared module importing it would reach
   * `runtime.onMessage` without the grep above seeing a `browser.` token.
   */
  it('does not import the extension messaging bus', () => {
    const hits = closure.filter((f) => /from\s+['"][^'"]*messaging['"]/.test(read(f))).sort();

    expect(
      hits,
      `The shared closure must not import runtime messaging. What it needed from ` +
        `it is a member on HostSession:\n${hits.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * Not even the IMPORT.
   *
   * `wxt/browser` resolves to `globalThis.browser?.runtime?.id ? ... :
   * globalThis.chrome` — `undefined` in a web page, so an unused import throws
   * nothing and the grep above would not see it either. It is still a
   * declaration that this file expects an extension, and it is what the
   * playground's `wxt/browser` shim existed to satisfy. That shim is deleted;
   * this is what keeps it deleted.
   */
  it('does not import wxt/browser at all', () => {
    const hits = closure.filter((f) => /from\s+['"]wxt\/browser['"]/.test(read(f))).sort();

    expect(
      hits,
      `The shared closure must not import wxt/browser. A web page has no ` +
        `extension namespace to import:\n${hits.join('\n')}`,
    ).toEqual([]);
  });
});
