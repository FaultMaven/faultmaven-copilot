/**
 * Importing the package's stylesheet must not restyle the host's application.
 *
 * It reset `*`, restyled `body`, every `button` and every `a:hover` on the
 * page, and set a 5-px scrollbar everywhere; `response-formatting.css` added
 * `.prose-sm` list rules that beat a host's typography plugin. In the extension
 * the panel IS the page, so none of it showed. In a host that embeds the panel,
 * every page was affected — including pages the panel has nothing to do with.
 *
 * Compiled through PostCSS/Tailwind, as a host compiles it, and asserted on the
 * emitted selectors: a rule that escapes the panel scope is one that reaches
 * the host's markup.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const PKG = join(process.cwd(), 'packages/copilot-ui');
const preset = require(join(PKG, 'tailwind-preset.cjs'));
const ROOT = '.fm-copilot-panel';

/** Authored rules, with comments stripped — prose about a selector is not one. */
function authoredLines(file: string): string[] {
  return readFileSync(join(PKG, 'styles', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n');
}

async function compile(file: string): Promise<postcss.Root> {
  const css = readFileSync(join(PKG, 'styles', file), 'utf8');
  const result = await postcss([
    tailwindcss({ presets: [preset], content: preset.content }),
  ]).process(css, { from: join(PKG, 'styles', file) });
  return postcss.parse(result.css);
}

/**
 * Selectors that reach a host's markup without it opting in.
 *
 * A UTILITY class (`.absolute`, `.sr-only`) matches only an element that
 * carries it, so it cannot restyle anything the host did not ask for — that is
 * what importing a Tailwind stylesheet means. What restyles a host is a rule
 * that matches by TAG or POSITION: `body`, `button`, `a:hover`,
 * `::-webkit-scrollbar`, `*`. Those are the ones that must be inside the panel.
 */
function unscopedSelectors(root: postcss.Root): string[] {
  const escaped: string[] = [];
  root.walkRules((rule) => {
    // `0%`, `to` and friends are keyframe steps, not element selectors.
    if (rule.parent?.type === 'atrule' && /keyframes/.test((rule.parent as postcss.AtRule).name)) {
      return;
    }
    for (const selector of rule.selectors) {
      const s = selector.trim();
      if (s.includes(ROOT)) continue;
      if (s.startsWith(':root') || s.startsWith('@')) continue;
      if (isOptIn(s)) continue;
      escaped.push(s);
    }
  });
  return [...new Set(escaped)];
}

/**
 * Does this selector require the host to have written one of our classes?
 *
 * The LEADING compound is what decides. `.space-x-2 > :not([hidden])` matches
 * only inside an element carrying `.space-x-2`, so the bare compounds after it
 * reach nothing the host did not opt into.
 */
function isOptIn(selector: string): boolean {
  // Strip escaped characters and bracketed groups first: Tailwind's arbitrary
  // values contain `+`, `~` and spaces that are not combinators.
  const flattened = selector.replace(/\\./g, 'x').replace(/\[[^\]]*\]/g, '');
  const lead = flattened.split(/[\s>+~]+/).filter(Boolean)[0] ?? '';
  return /[.#]/.test(lead);
}

describe('the package stylesheet stays inside the panel', () => {
  it('globals.css emits no rule outside the panel root', async () => {
    const root = await compile('globals.css');

    // Guards the guard: an empty parse would make the assertion vacuous.
    let ruleCount = 0;
    root.walkRules(() => { ruleCount += 1; });
    expect(ruleCount).toBeGreaterThan(5);

    const escaped = unscopedSelectors(root);
    expect(
      escaped,
      `These reach the HOST's markup, not just the panel's:\n${escaped.join('\n')}`,
    ).toEqual([]);
  }, 60_000);

  it('response-formatting.css emits no rule outside the panel root', async () => {
    const root = await compile('response-formatting.css');

    let ruleCount = 0;
    root.walkRules(() => { ruleCount += 1; });
    expect(ruleCount).toBeGreaterThan(5);

    const escaped = unscopedSelectors(root);
    expect(
      escaped,
      `These reach the HOST's markup, not just the panel's:\n${escaped.join('\n')}`,
    ).toEqual([]);
  }, 60_000);

  // The specific leaks the Dashboard review reported, named so a regression
  // says which one came back.
  it.each([
    ['a link hover that faded every anchor on the page', /(^|[^ ])a:hover/],
    ['a transition on every button', /(^|[^ ])button\s*\{/],
    ['a 5-px scrollbar everywhere', /^::-webkit-scrollbar/m],
    ['a reset on every element', /^\s*\*\s*,/m],
    ['a restyled body', /^body\s*\{/m],
  ])('no longer emits %s', (_label, pattern) => {
    const offending = authoredLines('globals.css').filter(
      (line) => pattern.test(line) && !line.includes('fm-copilot-panel'),
    );
    expect(offending, `unscoped:\n${offending.join('\n')}`).toEqual([]);
  });

  // `.prose-sm` is the one that beat the host's typography plugin.
  it('scopes the markdown list rules', () => {
    const proseLines = authoredLines('response-formatting.css').filter((l) =>
      l.includes('prose-sm'),
    );

    expect(proseLines.length).toBeGreaterThan(0); // the rules still exist
    for (const line of proseLines) {
      expect(line, `unscoped prose rule: ${line}`).toContain('fm-copilot-panel');
    }
  });

  /**
   * And no PREFLIGHT. Tailwind's base layer is a global reset — `*`, `html`,
   * `body`, every heading — and a class cannot scope it, so a stylesheet a host
   * imports must not bring one. The extension emits it from its own entry,
   * where the panel is the whole page.
   */
  it('emits no Tailwind preflight, which no class could scope', () => {
    expect(authoredLines('globals.css').some((l) => /@tailwind\s+base/.test(l))).toBe(false);
  });

  /**
   * Dropping preflight took the panel's OWN reset with it. Tailwind normalizes
   * form controls globally — a button starts with no border, no background and
   * an inherited font — and every button in the panel is styled with utilities
   * that assume exactly that. In a host with no preflight of its own the panel
   * came out full of grey system buttons; the playground, which is a host with
   * no reset, showed it. So the panel carries that much of a reset itself.
   */
  it('normalizes form controls inside the panel, for a host that has no reset', async () => {
    const root = await compile('globals.css');

    const buttonReset: string[] = [];
    root.walkRules((rule) => {
      if (!rule.selector.includes(ROOT)) return;
      if (!/\bbutton\b/.test(rule.selector)) return;
      rule.walkDecls((decl) => {
        buttonReset.push(`${decl.prop}: ${decl.value}`);
      });
    });

    expect(buttonReset, 'the panel emits no reset for its own buttons').not.toEqual([]);
    expect(buttonReset).toContain('background-color: transparent');
    expect(buttonReset).toContain('font-family: inherit');
  }, 60_000);

  /**
   * And it does that WITHOUT outweighing the utilities on the same element.
   * `.fm-copilot-panel button` weighs a class and an element, which beats
   * `.text-sm` no matter what order they are emitted in — the reset would win
   * every disagreement with the styling it exists to make possible. Inside
   * `:where()` the element contributes nothing, so the rule weighs one class
   * and the utility still wins on order.
   */
  it('writes that reset with :where(), so a utility on the element still wins', () => {
    const elementRules = authoredLines('globals.css').filter((line) =>
      /\.fm-copilot-panel\s+[^{]*\b(a|button|input|optgroup|select|textarea|ul|ol)\b/.test(line),
    );

    expect(elementRules.length).toBeGreaterThan(0); // the reset exists at all
    for (const line of elementRules) {
      expect(line, `outweighs a utility on the same element: ${line}`).toContain(':where(');
    }
  });

  it('the extension still gets a preflight of its own', () => {
    const own = readFileSync(join(process.cwd(), 'src/assets/styles/extension-base.css'), 'utf8');
    expect(own).toMatch(/@tailwind\s+base/);
    for (const entry of [
      'src/entrypoints/sidepanel_manual/main.tsx',
      'src/entrypoints/options/main.tsx',
    ]) {
      expect(
        readFileSync(join(process.cwd(), entry), 'utf8'),
        `${entry} must import the extension's own base layer`,
      ).toContain('extension-base.css');
    }
  });
});
