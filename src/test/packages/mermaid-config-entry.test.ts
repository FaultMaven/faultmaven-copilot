/**
 * `@faultmaven/copilot-ui/mermaid-config` costs nothing to import, and ships.
 *
 * Both properties are why it is a root module, as for `contract.ts`
 * (`contract-entry.test.ts`): the Dashboard imports it for its own diagrams and
 * must not pull the entry's eager graph with it (ADR-016 D3). Its one import is
 * the config's TYPE, which is erased.
 *
 * Checked on the TRANSPILED module, not by matching the source: TypeScript
 * decides what is erased, so the output either imports something or it does
 * not. `verbatimModuleSyntax` keeps every import that is not written as a type
 * import, as a host compiling under it would.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const PKG = join(process.cwd(), 'packages/copilot-ui');
const source = readFileSync(join(PKG, 'mermaid-config.ts'), 'utf8');

function transpile(code: string): string {
  return ts.transpileModule(code, {
    compilerOptions: {
      verbatimModuleSyntax: true,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText;
}

/**
 * Every import the emitted code makes: an import or re-export declaration, a
 * dynamic `import()`, or a `require()`. Parsed, not scanned: a bare scanner loses
 * its place after a template literal with a substitution, or a regex literal.
 */
function runtimeImports(code: string): string[] {
  const file = ts.createSourceFile('m.js', transpile(code), ts.ScriptTarget.ESNext, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) ||
      (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')))
    ) {
      found.push(node.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Each is only transpiled, never typechecked, and each leaves a runtime import behind. */
const RUNTIME_IMPORTS = [
  "import type from 'mermaid';\nexport const x = type;", // a default import whose binding is named `type`
  "import type , { a } from 'mermaid';\nexport const x = [type, a];", // the same, plus named imports
  'export const f = () => import(`mermaid`);',
  'declare const name: string;\nexport const m = require(name);',
  "import { A } from 'mermaid';\nexport const x: A = {} as A;",
  "import { type A } from 'mermaid';\nexport const x: A = {} as A;", // emits `import {} from 'mermaid'`
  "export { x } from './lib/x';",
  // After a template literal with a substitution, or a regex literal holding a backtick.
  "const K = 'm';\nexport const a = `fm-${K}`;\nexport const f = () => import('mermaid');",
  "const K = 'm';\nexport const a = `fm-${K}`;\nimport m from 'mermaid';\nexport const b = m;",
  "export const r = /`/;\nexport const f = () => import('mermaid');",
];

describe('the mermaid-config entry point', () => {
  it('is shipped to a git-dependency consumer', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
    expect(manifest.files).toContain('mermaid-config.ts');
  });

  it('imports NOTHING at runtime', () => {
    expect(transpile(source), 'the transpile must emit the module').toContain('MERMAID_CONFIG');
    expect(runtimeImports(source)).toEqual([]);
  });

  it('erases a type-only import', () => {
    expect(runtimeImports("import type { A } from 'mermaid';\nexport const x: A = {} as A;")).toEqual([]);
  });

  it.each(RUNTIME_IMPORTS)('catches %j', (code) => {
    expect(runtimeImports(code)).not.toEqual([]);
  });
});
