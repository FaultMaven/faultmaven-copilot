/**
 * The invariant, enforced against the tree rather than against a reviewer's
 * attention.
 *
 * Every other test in this suite proves that some particular call site now goes
 * through the host. None of them can prove that a NEW one has not appeared —
 * and a single `browser.storage.local.get` added to a component next month
 * would compile, pass, ship, and break the Dashboard silently the first time
 * the shared UI ran there. That failure has no natural owner, so it gets a
 * test that reads the directory.
 *
 * Deliberately a grep and not an import-graph check: what must not appear is a
 * TEXT, including in a string or a comment that would later be uncommented.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SHARED_UI = join(process.cwd(), 'packages', 'copilot-ui', 'shared', 'ui');

/**
 * Each pattern is one way the shared UI could stop being host-independent.
 * `reason` is what a failing run prints, because "forbidden pattern found" tells
 * whoever hits this nothing about what to do instead.
 */
const FORBIDDEN: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bbrowser\./,
    reason:
      'reaches a browser-extension API directly. Add the capability to HostAdapter ' +
      'and read it from useHost() instead — a web host has no `browser` at all.',
  },
  {
    pattern: /\bchrome\./,
    reason: 'reaches a browser-extension API directly. Same fix as `browser.`.',
  },
  {
    pattern: /\bAuthScreen\b/,
    reason:
      'the shared UI must render no sign-in. Authentication happens above the ' +
      'boundary, in each host\'s entry point; the panel takes a session it cannot be without.',
  },
  {
    pattern: /\bWelcomeScreen\b/,
    reason: 'first-run setup is host-specific. It belongs in the extension entry point.',
  },
  {
    pattern: /\bLocalLoginForm\b/,
    reason: 'a sign-in form. See AuthScreen.',
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe('the package UI is host-independent', () => {
  const files = walk(SHARED_UI);

  // Guards the guard: a walk that silently returned nothing would pass every
  // assertion below while checking nothing at all.
  it('finds the shared UI to check', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(FORBIDDEN)('contains no $pattern', ({ pattern, reason }) => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (pattern.test(line)) {
          hits.push(`${relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(hits, `${pattern} ${reason}\n\n${hits.join('\n')}`).toEqual([]);
  });
});
