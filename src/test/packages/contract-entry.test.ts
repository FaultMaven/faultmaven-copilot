/**
 * `@faultmaven/copilot-ui/contract` costs nothing to import.
 *
 * The advertisement contract has to be reachable from code that must not load
 * the UI: the Dashboard's login page, which decides what to advertise before
 * anyone is signed in, and the extension's content script, which reads the
 * attribute on every page it is injected into. Reached through the package's
 * MAIN entry, three constants and a predicate arrive with the store, the
 * transport and the persistence layer attached — the Dashboard measured
 * 776 -> 983 kB on its login bundle, which ADR-016 D3 forbids.
 *
 * The property is not "the file looks small". It is that its transitive import
 * graph is EMPTY, which is what a bundler follows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const PKG = join(process.cwd(), 'packages/copilot-ui');
const CONTRACT = join(PKG, 'contract.ts');

/** Import specifiers a bundler would follow out of one module. */
function specifiersOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const found: string[] = [];
  const patterns = [
    /(?:^|\s)import\s+[^;]*?from\s*['"]([^'"]+)['"]/g, // import x from 'y'
    /(?:^|\s)import\s*['"]([^'"]+)['"]/g, //              import 'y' (side effect)
    /(?:^|\s)export\s+[^;]*?from\s*['"]([^'"]+)['"]/g, // export … from 'y'
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, //          dynamic import
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  }
  return [...new Set(found)];
}

function resolveRelative(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null; // a bare specifier: a dependency
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        if (readFileSync(candidate)) return candidate;
      } catch {
        /* a directory: try the next candidate */
      }
    }
  }
  return null;
}

/** Everything a bundler would pull in, starting from one module. */
function importGraph(entry: string): { files: string[]; bare: string[] } {
  const seen = new Set([entry]);
  const bare = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop() as string;
    for (const specifier of specifiersOf(file)) {
      const resolved = resolveRelative(file, specifier);
      if (!resolved) {
        bare.add(specifier);
        continue;
      }
      if (!seen.has(resolved)) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return { files: [...seen], bare: [...bare] };
}

describe('the contract entry point', () => {
  it('exists at the package root and is shipped', () => {
    expect(existsSync(CONTRACT)).toBe(true);

    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
    expect(
      manifest.files,
      'a consumer installing this package by git dependency must receive it',
    ).toContain('contract.ts');
  });

  it('carries the names both repositories need, at the exact values they send', async () => {
    const contract = await import('@faultmaven/copilot-ui/contract');

    // THE VALUES, not just the presence of the names. These are wire formats
    // crossing two repositories on two release trains: rename
    // `DASHBOARD_PANEL_WITHDRAWN_MESSAGE`'s STRING and every suite here stays
    // green — the extension simply stops recognising a message every Dashboard
    // in the field is posting, so no tab is ever released again. That is the
    // dark-tab failure, arriving through a refactor nobody could see.
    expect(contract.DASHBOARD_PANEL_ATTR).toBe('data-faultmaven-dashboard-panel');
    expect(contract.DASHBOARD_PANEL_MESSAGE).toBe('FM_DASHBOARD_PANEL_AVAILABLE');
    expect(contract.DASHBOARD_PANEL_WITHDRAWN_MESSAGE).toBe('FM_DASHBOARD_PANEL_WITHDRAWN');
    expect(typeof contract.dashboardAdvertisesPanel).toBe('function');
  });

  it.each([
    ['index.ts', join(PKG, 'index.ts')],
    ['shared/host/index.ts', join(PKG, 'shared', 'host', 'index.ts')],
  ])('re-exports every handshake name from %s, not just the subpath', (_label, file) => {
    // The Dashboard is told to import the package ENTRY and nothing else (its
    // CLAUDE.md makes that a rule), so a name reachable only from `/contract`
    // is a name that consumer has to hardcode — the exact drift a single
    // definition exists to prevent. Both re-export sites were already listing
    // the other three and silently omitted the new one.
    //
    // Read from SOURCE rather than imported: evaluating the entry pulls in the
    // whole panel — React, the markdown renderer, the store — which is seconds
    // of work to answer a question about an export list, and slow enough to
    // time out inside the full suite while passing alone.
    const source = readFileSync(file, 'utf8');
    const block = source.match(/export \{([^}]*)\} from '(?:\.|\.\.\/\.\.)\/contract';/);

    expect(block, `${file} does not re-export from the contract module at all`).not.toBeNull();
    for (const name of [
      'DASHBOARD_PANEL_ATTR',
      'DASHBOARD_PANEL_MESSAGE',
      'DASHBOARD_PANEL_WITHDRAWN_MESSAGE',
      'dashboardAdvertisesPanel',
    ]) {
      expect(block![1]).toContain(name);
    }
  });

  it('imports NOTHING, so a bundle of it is the module alone', () => {
    const { files, bare } = importGraph(CONTRACT);

    expect(
      bare,
      `a dependency would be bundled with it: ${bare.join(', ')}`,
    ).toEqual([]);
    expect(
      files.map((f) => relative(PKG, f)),
      'the graph must be the module itself and nothing else',
    ).toEqual(['contract.ts']);
  });

  /**
   * The control. A walker that finds nothing finds nothing everywhere, so the
   * assertion above is only worth something if the same walk over the package's
   * MAIN entry — the import that was too expensive — comes back large.
   */
  it('and the walk can tell: the main entry pulls in the panel', () => {
    const { files, bare } = importGraph(join(PKG, 'index.ts'));

    expect(files.length).toBeGreaterThan(50);
    expect(bare).toContain('react');
  });

  /**
   * And the extension takes the cheap door. `presence-marker` is imported by
   * the auth-bridge CONTENT SCRIPT, which is injected into every Dashboard page
   * — through the main entry it was a 4 MB script to read one attribute.
   */
  it('is how the extension reaches the contract', () => {
    for (const consumer of [
      'src/extension/auth/presence-marker.ts',
      'src/entrypoints/auth-bridge.content.ts',
    ]) {
      const source = readFileSync(join(process.cwd(), consumer), 'utf8');
      expect(
        /from\s*['"]@faultmaven\/copilot-ui['"]/.test(source),
        `${consumer} reaches the contract through the package's main entry, ` +
          `which brings the panel with it`,
      ).toBe(false);
    }
  });
});
