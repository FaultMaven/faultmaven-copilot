/**
 * `@faultmaven/copilot-ui/deleting` is the door the Dashboard reaches the
 * deleting notice and re-read schedule through (faultmaven#2341): it carries
 * `lib/cases/deleting`'s names unchanged, imports nothing else, and ships.
 *
 * A dropped name breaks a build nothing in THIS repo compiles, so the names are
 * pinned by identity. The import is checked on the TRANSPILED module, as
 * `mermaid-config-entry.test.ts` does: TypeScript decides what is erased, so the
 * output either imports something or it does not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import * as door from '@faultmaven/copilot-ui/deleting';
import * as lib from '@faultmaven/copilot-ui/lib/cases/deleting';

const PKG = join(process.cwd(), 'packages/copilot-ui');

const NAMES = [
  'CASE_DELETING_NOTICE',
  'DELETING_REREAD_CAP_MS',
  'DELETING_REREAD_FIRST_MS',
  'DELETING_REREAD_MAX_MS',
  'nextDeletingReread',
];

/**
 * The module specifier of every import the emitted code makes: an import or
 * re-export declaration, a dynamic `import()`, or a `require()`. Parsed, not
 * scanned. `verbatimModuleSyntax` keeps every import not written as a type
 * import, as a host compiling under it would.
 */
function runtimeImports(path: string): string[] {
  const out = ts.transpileModule(readFileSync(join(PKG, path), 'utf8'), {
    compilerOptions: {
      verbatimModuleSyntax: true,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText;
  const file = ts.createSourceFile('m.js', out, ts.ScriptTarget.ESNext, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
      found.push((node.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isImportEqualsDeclaration(node)) {
      found.push(node.moduleReference.getText(file));
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      found.push(node.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('the deleting door', () => {
  it("exports exactly lib/cases/deleting's names", () => {
    expect(Object.keys(door).sort()).toEqual(NAMES);
    expect(Object.keys(lib).sort()).toEqual(NAMES);
  });

  it.each(NAMES)('re-exports %s by identity', (name) => {
    const fromDoor = (door as Record<string, unknown>)[name];
    expect(fromDoor).toBeDefined();
    expect(fromDoor).toBe((lib as Record<string, unknown>)[name]);
  });

  it('imports only ./lib/cases/deleting at runtime', () => {
    expect(runtimeImports('deleting.ts')).toEqual(['./lib/cases/deleting']);
  });

  it('reaches nothing further: lib/cases/deleting imports nothing at runtime', () => {
    expect(runtimeImports('lib/cases/deleting.ts')).toEqual([]);
  });

  it('is shipped to a git-dependency consumer', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
    expect(manifest.files).toContain('deleting.ts');
  });
});
