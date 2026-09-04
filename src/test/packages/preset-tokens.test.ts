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

async function emittedCss(config: Record<string, unknown>): Promise<string> {
  const result = await postcss([tailwindcss(config as never)]).process(
    '@tailwind components;@tailwind utilities;',
    { from: undefined },
  );
  return result.css;
}

/**
 * The class names Tailwind actually emitted, un-escaped back to how they are
 * written in a component.
 *
 * The previous form built a selector string out of each class and asked whether
 * the stylesheet contained it. That is pattern construction from scanned input:
 * it escaped `:`, `/` and `.` and not the backslash, so a class carrying one
 * would have produced a selector that matched the wrong thing — CodeQL's
 * `js/incomplete-sanitization`, and a fair call even though these names come
 * from our own sources. Reading the emitted selectors into a Set removes the
 * construction entirely, so there is nothing left to escape.
 *
 * `.hover\:bg-fm-accent-strong:hover` → `hover:bg-fm-accent-strong`: the
 * capture stops at the first unescaped `:`, which is where Tailwind's own
 * variant suffix begins.
 */
function emittedClasses(css: string): Set<string> {
  const classes = new Set<string>();
  for (const [, escaped] of css.matchAll(/\.((?:[\w-]|\\.)+)/g)) {
    classes.add(escaped.replace(/\\(.)/g, '$1'));
  }
  return classes;
}

describe('the package theme preset', () => {
  it('emits every fm- class the package uses', async () => {
    const used = usedFmClasses();

    // Guards the guard: a regex that stopped matching, or a source walk that
    // returned nothing, would make every assertion below pass having checked
    // nothing at all.
    expect(used.length).toBeGreaterThan(60);
    expect(used).toContain('bg-fm-canvas');
    expect(used).toContain('font-fm-sans');

    const emitted = emittedClasses(
      await emittedCss({ presets: [preset], content: preset.content }),
    );

    // Guards the guard, second half: an extractor that returned nothing would
    // report every class as missing, and one that returned junk could hide a
    // real absence. Both are visible here.
    expect(emitted.size).toBeGreaterThan(60);
    expect(emitted.has('bg-fm-canvas')).toBe(true);

    const missing = used.filter((cls) => !emitted.has(cls));

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
  it('publishes where its own sources are, for a host to spread', () => {
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

/**
 * And the HOST's config emits them too, which is a different question.
 *
 * The check above builds its own Tailwind config out of the preset, so it says
 * the preset defines the tokens — not that anything a user runs emits them. It
 * cannot: `content` is the one key Tailwind does NOT merge across presets, so a
 * host listing only its own files produces a stylesheet with none of the shared
 * UI's classes in it. Nothing throws; the panel renders unstyled.
 *
 * That is not hypothetical. Between the relocation and this test the
 * extension's config globbed `./src/**` only, and **366** of the classes the
 * package uses were absent from the shipped stylesheet — surviving review, the
 * digest guard (which tracks change, not correctness) and the check above.
 */
describe('the extension config emits the package classes', () => {
  it('emits every fm- class the package uses', async () => {
    const used = usedFmClasses();
    expect(used.length).toBeGreaterThan(60);

    // The REAL config, as `pnpm build` loads it.
    const extensionConfig = require(join(process.cwd(), 'tailwind.config.cjs'));
    const emitted = emittedClasses(await emittedCss(extensionConfig));

    const missing = used.filter((cls) => !emitted.has(cls));

    expect(
      missing,
      `The extension's own Tailwind config emits no css for these, so they ` +
        `render unstyled in the shipped extension. Spread the package's globs ` +
        `into its \`content\`:\n${missing.join('\n')}`,
    ).toEqual([]);
  }, 60_000);
});
