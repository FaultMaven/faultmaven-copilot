/**
 * `@faultmaven/copilot-ui/mermaid-config` costs nothing to import, and ships.
 *
 * Both properties are why it is a root module, as for `contract.ts`
 * (`contract-entry.test.ts`): the Dashboard imports it for its own diagrams and
 * must not pull the entry's eager graph with it (ADR-016 D3). Its one import is
 * the config's TYPE, which is erased. That carve-out is exact: a value import of
 * the same name, or an inline `import { type X }` (a side-effect import under
 * `verbatimModuleSyntax`), would bundle mermaid with it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG = join(process.cwd(), 'packages/copilot-ui');
const source = readFileSync(join(PKG, 'mermaid-config.ts'), 'utf8');

/** The one import erasure removes: a statement-level `import type … from 'mermaid'`. */
const TYPE_ONLY_MERMAID = /^\s*import\s+type\s+[^;'"]*?from\s*['"]mermaid['"];?[ \t]*$/gm;

/** Import specifiers a bundler would follow out of a module (as in `contract-entry.test.ts`). */
function specifiersOf(code: string): string[] {
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const patterns = [
    /(?:^|\s)import\s+[^;]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\s)import\s*['"]([^'"]+)['"]/g,
    /(?:^|\s)export\s+[^;]*?from\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return [...new Set(patterns.flatMap((p) => [...stripped.matchAll(p)].map((m) => m[1])))];
}

/** What survives erasure. */
function runtimeSpecifiers(code: string): string[] {
  return specifiersOf(code.replace(TYPE_ONLY_MERMAID, ''));
}

/** [module source, what must survive erasure]. The first two are the carve-out; the rest must not pass it. */
const CARVE_OUT_CASES: Array<[string, string[]]> = [
  ["import type { MermaidConfig } from 'mermaid';", []],
  ['import type {\n  MermaidConfig,\n} from "mermaid"', []],
  ["import { MermaidConfig } from 'mermaid';", ['mermaid']],
  ["import { type MermaidConfig } from 'mermaid';", ['mermaid']],
  ["import mermaid from 'mermaid';", ['mermaid']],
  ["import 'mermaid';", ['mermaid']],
  ["const m = require('mermaid');", ['mermaid']],
  ["const m = import('mermaid');", ['mermaid']],
  ["export { x } from './lib/x';", ['./lib/x']],
  ["import type { X } from './lib/x';", ['./lib/x']],
];

describe('the mermaid-config entry point', () => {
  it('is shipped to a git-dependency consumer', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
    expect(manifest.files).toContain('mermaid-config.ts');
  });

  it('imports NOTHING at runtime: its only import is the erased config type', () => {
    expect(specifiersOf(source), 'the type import is what the carve-out is for').toEqual(['mermaid']);
    expect(runtimeSpecifiers(source)).toEqual([]);
  });

  it.each(CARVE_OUT_CASES)('the carve-out admits only a type import of mermaid: %j', (code, expected) => {
    expect(runtimeSpecifiers(code)).toEqual(expected);
  });
});
