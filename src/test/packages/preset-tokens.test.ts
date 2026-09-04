/**
 * Every `fm-*` class the package uses is emitted by the package's preset.
 *
 * A missing Tailwind token is not an error. The class is simply never emitted
 * and the element renders unstyled — nothing throws, nothing turns red, and the
 * defect is visible only to whoever looks at that screen in that host. The two
 * repositories had already drifted this way before the preset existed:
 * `bg-fm-bg`, `font-fm-sans` and `font-fm-mono` were used by this UI and absent
 * from the Dashboard's config.
 *
 * So this does not compare two lists of token names — that would drift the same
 * way. It RUNS Tailwind over the package's sources with the preset alone, and
 * asserts every `fm-` class the sources actually use came out the other side as
 * a rule. A token deleted from the preset, a class typed wrong in a component,
 * and a `content` glob that stops matching are all the same failure here.
 *
 * It scans TEXT, so a class named in a comment counts as used. That is the
 * conservative direction — a class worth writing down is a class that ought to
 * resolve — but it means describing a broken class in a comment has to spell it
 * around rather than quote it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const PKG = join(process.cwd(), 'packages/copilot-ui');
const preset = require(join(PKG, 'tailwind-preset.cjs'));

function sourcesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourcesUnder(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * The `fm-`-bearing classes the package's sources use.
 *
 * Matched on the whole utility (`bg-fm-canvas`, `text-fm-title`,
 * `hover:bg-fm-elevated`), because that is what Tailwind emits and what the
 * browser matches — a token that exists under the wrong utility family is still
 * an unstyled element.
 */
function usedFmClasses(): string[] {
  const found = new Set<string>();
  const CLASS = /(?:^|[\s"'`{}])((?:[a-z-]+:)*[a-z]+(?:-[a-z0-9]+)*-fm-[a-z0-9-]+(?:\/[0-9]+)?)/g;
  for (const file of [...sourcesUnder(join(PKG, 'shared')), ...sourcesUnder(join(PKG, 'lib'))]) {
    const src = readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = CLASS.exec(src))) found.add(m[1]);
  }
  return [...found].sort();
}

async function emittedCss(): Promise<string> {
  const result = await postcss([
    tailwindcss({ presets: [preset], content: preset.content }),
  ]).process('@tailwind components;@tailwind utilities;', { from: undefined });
  return result.css;
}

/** Tailwind escapes `/` and `:` in generated selectors. */
const selectorFor = (cls: string) => '.' + cls.replace(/([:/.])/g, '\\$1');

describe('the package theme preset', () => {
  it('emits every fm- class the package uses', async () => {
    const used = usedFmClasses();

    // Guards the guard: a regex that stopped matching, or a source walk that
    // returned nothing, would make every assertion below pass having checked
    // nothing at all.
    expect(used.length).toBeGreaterThan(60);
    expect(used).toContain('bg-fm-canvas');
    expect(used).toContain('font-fm-sans');

    const css = await emittedCss();
    const missing = used.filter((cls) => !css.includes(selectorFor(cls)));

    expect(
      missing,
      `These classes are used by the package and produce NO css from its own ` +
        `preset. A missing token renders the element unstyled and throws ` +
        `nothing:\n${missing.join('\n')}`,
    ).toEqual([]);
  }, 60_000);

  // The preset carries the package's own content globs so a host that forgets
  // to glob node_modules still gets these classes. Without them the check above
  // would pass against an empty stylesheet in a real host.
  it('globs its own sources, so a host cannot purge the shared UI away', () => {
    expect(preset.content.some((g: string) => g.includes('shared'))).toBe(true);
    expect(preset.content.some((g: string) => g.includes('lib'))).toBe(true);
    for (const glob of preset.content) expect(glob.startsWith(PKG)).toBe(true);
  });

  // `darkMode: 'class'` is part of the theme, not of a host's config. The
  // Dashboard's config did not have it.
  it('carries darkMode with the theme', () => {
    expect(preset.darkMode).toBe('class');
  });
});
