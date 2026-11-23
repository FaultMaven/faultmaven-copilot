/**
 * `@faultmaven/copilot-ui/deleting` is the door the Dashboard reaches the
 * deleting notice and re-read schedule through (faultmaven#2341): it carries
 * `lib/cases/deleting`'s names unchanged, imports nothing else, and ships.
 *
 * A dropped name breaks a build nothing in THIS repo compiles, so the names are
 * pinned. Identity alone cannot rule out a door holding its own copy (equal
 * primitives are identical), so the door is also required to be re-exports
 * only, with no declaration of its own. Both that and the import are checked
 * on the TRANSPILED module, as `mermaid-config-entry.test.ts` does: TypeScript
 * decides what is erased, so the output either imports something or it does
 * not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import * as door from '@faultmaven/copilot-ui/deleting';
import * as lib from '@faultmaven/copilot-ui/lib/cases/deleting';

const PKG = join(process.cwd(), 'packages/copilot-ui');
const LIB_SPECIFIER = './lib/cases/deleting';

const NAMES = [
  'CASE_DELETING_NOTICE',
  'DELETING_REREAD_CAP_MS',
  'DELETING_REREAD_FIRST_MS',
  'DELETING_REREAD_MAX_MS',
  'nextDeletingReread',
];

/** `verbatimModuleSyntax` keeps every import not written as a type import, as a host compiling under it would. */
function transpile(code: string): string {
  return ts.transpileModule(code, {
    compilerOptions: {
      verbatimModuleSyntax: true,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    },
  }).outputText;
}

function source(path: string): string {
  return readFileSync(join(PKG, path), 'utf8');
}

function parsed(code: string): ts.SourceFile {
  return ts.createSourceFile('m.js', transpile(code), ts.ScriptTarget.ESNext, true);
}

/**
 * The module specifier of every import the emitted code makes: an import or
 * re-export declaration, a dynamic `import()`, or a `require()`. Parsed, not
 * scanned.
 */
function runtimeImports(code: string): string[] {
  const file = parsed(code);
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

/**
 * Each top-level statement of the emitted code that is NOT a re-export from
 * `lib/cases/deleting`: a declaration, an import, a re-export from anywhere
 * else, or a local `export { … }`.
 */
function notALibReExport(code: string): string[] {
  const file = parsed(code);
  return file.statements
    .filter(
      (s) =>
        !(
          ts.isExportDeclaration(s) &&
          s.moduleSpecifier !== undefined &&
          ts.isStringLiteral(s.moduleSpecifier) &&
          s.moduleSpecifier.text === LIB_SPECIFIER
        ),
    )
    .map((s) => s.getText(file));
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

  it('is re-exports from ./lib/cases/deleting and nothing else', () => {
    const emitted = parsed(source('deleting.ts'));
    expect(emitted.statements.length, 'the transpile must emit the door').toBeGreaterThan(0);
    expect(notALibReExport(source('deleting.ts'))).toEqual([]);
  });

  it('imports only ./lib/cases/deleting at runtime', () => {
    expect(runtimeImports(source('deleting.ts'))).toEqual([LIB_SPECIFIER]);
  });

  it('reaches nothing further: lib/cases/deleting imports nothing at runtime', () => {
    const libSource = source('lib/cases/deleting.ts');
    expect(transpile(libSource), 'the transpile must emit the module').toContain('CASE_DELETING_NOTICE');
    expect(runtimeImports(libSource)).toEqual([]);
  });

  it('is shipped to a git-dependency consumer', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
    expect(manifest.files).toContain('deleting.ts');
  });
});

describe('the checks above can fail', () => {
  it.each([
    ['a static import', "import { a } from 'x';\nexport const b = a;", ['x']],
    ['a re-export', "export { a } from 'x';", ['x']],
    ['a dynamic import()', "export const f = () => import('x');", ["import('x')"]],
    ['a require()', "declare const require: (m: string) => unknown;\nexport const m = require('x');", ["require('x')"]],
  ])('runtimeImports catches %s', (_label, code, expected) => {
    expect(runtimeImports(code)).toEqual(expected);
  });

  it('runtimeImports erases a type-only import', () => {
    expect(runtimeImports("import type { A } from 'x';\nexport const b: A = {} as A;")).toEqual([]);
  });

  it.each([
    ['its own declaration', `export { nextDeletingReread } from '${LIB_SPECIFIER}';\nexport const CASE_DELETING_NOTICE = 'copy';`],
    ['a local export list', "const CASE_DELETING_NOTICE = 'copy';\nexport { CASE_DELETING_NOTICE };"],
    ['a re-export from elsewhere', "export { CASE_DELETING_NOTICE } from './lib/cases/other';"],
  ])('notALibReExport catches %s', (_label, code) => {
    expect(notALibReExport(code)).not.toEqual([]);
  });
});
