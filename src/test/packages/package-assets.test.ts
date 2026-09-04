/**
 * Every asset the package references, the package owns.
 *
 * `src/shared/ui` references its logo as `/icon/*.svg` — root-absolute, because
 * that is the one form that resolves identically in an extension page and on a
 * web page. Root-absolute means "whatever the host serves at `/`", so an asset
 * the package uses but does not ship is a broken `<img>` in any host that has
 * not been told to copy it: nothing thrown, nothing red. That is exactly what
 * the spike observed before the proof's `publicDir` was pointed at the icons.
 *
 * Two assertions: the package holds what it asks for, and the host actually
 * serves it.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PKG = join(ROOT, 'packages/copilot-ui');

function sourcesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourcesUnder(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

function referencedAssets(): string[] {
  const found = new Set<string>();
  const REF = /["'`](\/(?:icon|assets)\/[A-Za-z0-9._/-]+)["'`]/g;
  for (const file of [...sourcesUnder(join(PKG, 'shared')), ...sourcesUnder(join(PKG, 'lib'))]) {
    const src = readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = REF.exec(src))) found.add(m[1]);
  }
  return [...found].sort();
}

describe('the package owns the assets it references', () => {
  const referenced = referencedAssets();

  // Guards the guard: a walk that found nothing would make the assertion below
  // vacuous, and this is a check about ABSENCE.
  it('references assets at all', () => {
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced).toContain('/icon/square-transparent.svg');
  });

  it('ships every one of them in its own public directory', () => {
    const missing = referenced.filter((ref) => !existsSync(join(PKG, 'public', ref)));

    expect(
      missing,
      `Referenced by the package and not shipped by it. A host would render a ` +
        `broken image and throw nothing:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  // And the extension actually puts them where a root-absolute path finds them.
  // `pnpm sync-ui-assets` runs before every dev, build and zip; this is what
  // says so out loud rather than trusting a lifecycle hook nobody re-reads.
  it('the extension serves them from its own web root', () => {
    const missing = referenced.filter((ref) => !existsSync(join(ROOT, 'public', ref)));

    expect(
      missing,
      `Not present under public/. Run \`pnpm sync-ui-assets\`; it is wired into ` +
        `predev, prebuild and prezip:\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});
