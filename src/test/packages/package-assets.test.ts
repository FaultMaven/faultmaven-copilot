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
  it('the extension serves them from its own web root', () => {
    const missing = referenced.filter((ref) => !existsSync(join(ROOT, 'public', ref)));

    expect(
      missing,
      `Not present under public/. Run \`pnpm sync-ui-assets\`:\n${missing.join('\n')}`,
    ).toEqual([]);
  });

  /**
   * …and the wiring that PUT them there, which the assertion above can no
   * longer see.
   *
   * `pretest` runs the sync, so by the time that check runs the files exist
   * whatever the rest of the lifecycle does — it would pass on a tree where
   * every other hook had been deleted, and the extension would ship without its
   * logo. This is the half that still fails in that case.
   *
   * Every script that BUILDS or SERVES the extension is listed, because npm
   * lifecycle hooks fire for an exact script name only: `prebuild` does nothing
   * for `build:firefox`, which is how the Firefox artifact came to have no
   * pre-hook at all.
   */
  it('is wired into every script that builds, serves or tests the extension', () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
    const mustSync = [
      'predev', 'predev:firefox',
      'prebuild', 'prebuild:firefox',
      'prezip', 'prezip:firefox',
      'pretest', 'pretest:coverage', 'pretest:ui',
    ];

    const unwired = mustSync.filter((name) => !(scripts[name] ?? '').includes('sync-ui-assets'));

    expect(
      unwired,
      `These lifecycle scripts do not sync the package's assets, so the tree ` +
        `they produce is missing the logo — a broken <img>, thrown by ` +
        `nothing:\n${unwired.join('\n')}`,
    ).toEqual([]);

    // The hook is only as good as the script it calls.
    expect(scripts['sync-ui-assets']).toContain('scripts/sync-ui-assets.mjs');
  });
});
