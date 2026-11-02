import { describe as vitestDescribe, it, expect } from 'vitest';

// The module under test is a plain ESM script with no dependencies, which is
// why #268 factored `describe` out of the I/O — "so it is testable". It then
// shipped with no test, and was wrong on its first real bump.
// @ts-expect-error — a .mjs script with no type declarations.
import { describe as describeHop } from '../../../scripts/report-contract-hop.mjs';

/**
 * A miniature vendored `contract-notes.json`. Its entries are deliberately
 * OLDEST first, the reverse of what the API publishes, so "no sort at all"
 * fails the ordering tests below rather than passing on the fixture's luck.
 */
const NOTES = {
  contractVersion: '3.8.0',
  entries: [
    { version: '2.0.0', level: 'MAJOR', title: 'An old entry.', body: 'Still part of 2.0.0.' },
    { version: '3.7.0', level: 'MINOR', title: 'A title-only entry.', body: '' },
    { version: '3.8.0', level: 'MINOR', title: 'The newest entry.', body: '* Its first point.\n* Its second.' },
  ],
  vocabularies: {},
};

const pin = (contractVersion: string) => ({
  repository: 'FaultMaven/faultmaven',
  ref: 'a'.repeat(40),
  contractVersion,
});

const hop = (from: string, to: string, notes: unknown = NOTES) =>
  describeHop({ before: pin(from), after: pin(to), notes });

const versionsIn = (out: string) => [...out.matchAll(/^(\d+\.\d+\.\d+) — /gm)].map((m) => m[1]);

vitestDescribe('the contract-hop disclosure', () => {
  it('prints ONE entry for a one-contract hop: heading, blank line, body', () => {
    const out = hop('3.7.0', '3.8.0');

    expect(out).toContain('One contract adopted:');
    expect(out).toContain('```\n3.8.0 — MINOR. The newest entry.\n\n* Its first point.\n* Its second.\n```');
    // The entries outside the range are a different contract's text.
    expect(versionsIn(out)).toEqual(['3.8.0']);
  });

  it('prints a title-only entry with no blank line and no body', () => {
    expect(hop('3.6.0', '3.7.0')).toContain('```\n3.7.0 — MINOR. A title-only entry.\n```');
  });

  it('reports every entry a multi-contract hop crossed, NEWEST first, AND says it is several', () => {
    // The disclosure's whole purpose: a bump described as adopting one contract
    // can carry several, and the reviewer is consenting to all of them. The
    // heading is asserted too: collapse the multi arm into the single arm and a
    // two-contract bump renders under "One contract adopted".
    const out = hop('3.6.0', '3.8.0');

    expect(versionsIn(out)).toEqual(['3.8.0', '3.7.0']);
    expect(out).toMatch(/2 contracts adopted, not one/);
    expect(out).not.toContain('One contract adopted');
  });

  it('orders NUMERICALLY, not lexically', () => {
    // 10.x is where a lexical comparison first goes wrong: it places '10.0.0'
    // before '9.0.0'. The oracle is explicit, not `[...order].sort()`, which is
    // lexical and so could not tell the two apart.
    const notes = {
      entries: [
        { version: '9.0.0', level: 'MAJOR', title: 'Nine.', body: '' },
        { version: '10.0.0', level: 'MAJOR', title: 'The one after nine.', body: '' },
      ],
    };
    expect(versionsIn(hop('8.0.0', '10.0.0', notes))).toEqual(['10.0.0', '9.0.0']);
  });

  it('warns rather than goes quiet when the pin moved but no entry matched', () => {
    // Silence and confidence are the two outputs this must never produce by
    // accident: the bump is real, and an empty list would teach nothing.
    const out = hop('3.8.0', '9.9.9');

    expect(out).toMatch(/9\.9\.9/);
    expect(out).toContain('No contract entries matched');
    expect(out).not.toContain('One contract adopted');
  });

  it('says what it could not read when the notes are missing or not notes', () => {
    for (const notes of [null, {}, { entries: 'not a list' }]) {
      const out = hop('3.7.0', '3.8.0', notes);
      expect(out).toContain('Could not read the vendored contract notes');
      expect(out).not.toContain('One contract adopted');
    }
  });

  it('flags a downgrade or an unparseable version rather than listing anything', () => {
    for (const [from, to] of [['3.8.0', '3.7.0'], ['3.7.0', 'next']]) {
      expect(hop(from, to)).toContain('Not an ordinary forward hop');
    }
  });

  it('says nothing when the pin did not move', () => {
    expect(hop('3.8.0', '3.8.0')).toBe('');
  });

  it('says nothing when there is no pin to compare', () => {
    expect(describeHop({ before: null, after: pin('3.8.0'), notes: NOTES })).toBe('');
    expect(describeHop({ before: pin('3.7.0'), after: null, notes: NOTES })).toBe('');
  });
});
