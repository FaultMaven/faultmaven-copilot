import { describe as vitestDescribe, it, expect } from 'vitest';

// The module under test is a plain ESM script with no dependencies, which is
// why #268 factored `describe` out of the fetching — "so it is testable". It
// then shipped with no test, and was wrong on its first real bump.
// @ts-expect-error — a .mjs script with no type declarations.
import { describe as describeHop } from '../../../scripts/report-contract-hop.mjs';

/**
 * A miniature `contract_version.py`, in the shape the real one has.
 *
 * Two properties of the real file are reproduced deliberately, because both
 * have already produced a bug:
 *
 *  - entries are NOT in version order (3.6.0 sits below 2.0.0 here, as it does
 *    upstream, because one contract took a number while another sat in review);
 *  - the last entry is followed by real code, not by another header.
 */
const NOTES = [
  '"""The version of the API contract, moved by hand."""',
  '',
  '# 3.8.0 — MINOR. The newest entry.',
  '# Its second line.',
  '#',
  '# Its fourth line, after a bare comment marker.',
  '',
  '# 3.7.0 — MINOR. The entry before it.',
  '# Which also has a second line.',
  '',
  '# 2.0.0 — MAJOR. An old entry, deliberately out of order.',
  '# Still part of 2.0.0.',
  '',
  'API_CONTRACT_VERSION = "3.8.0"',
].join('\n');

const pin = (contractVersion: string) => ({
  repository: 'FaultMaven/faultmaven',
  ref: 'a'.repeat(40),
  contractVersion,
});

vitestDescribe('the contract-hop disclosure', () => {
  it('prints ONE entry for a one-contract hop, not the whole history', () => {
    // The defect this test exists for. Every subsequent header is itself a `#`
    // line, so a walk that stops only at "not a comment" runs through all of
    // them: on the real file the 3.8.0 bump captured 528 lines instead of 37,
    // under a heading that said "One contract adopted".
    const out = describeHop({
      before: pin('3.7.0'),
      after: pin('3.8.0'),
      notes: NOTES,
    });

    expect(out).toContain('3.8.0 — MINOR. The newest entry.');
    expect(out).toContain('Its fourth line, after a bare comment marker.');
    // The entries BELOW it are a different contract's text and must not appear.
    expect(out).not.toContain('The entry before it.');
    expect(out).not.toContain('An old entry, deliberately out of order.');
  });

  it('never pastes code into the prose', () => {
    // The FIRST version's bug, from the other end: an entry with no header
    // after it ran to EOF. Both halves of the boundary rule are load-bearing.
    const out = describeHop({
      before: pin('1.0.0'),
      after: pin('2.0.0'),
      notes: NOTES,
    });

    expect(out).toContain('An old entry, deliberately out of order.');
    expect(out).toContain('Still part of 2.0.0.');
    expect(out).not.toContain('API_CONTRACT_VERSION');
  });

  it('reports every entry a multi-contract hop actually crossed', () => {
    // The disclosure's whole purpose: a bump described as adopting one contract
    // can carry several, and the reviewer is consenting to all of them.
    const out = describeHop({
      before: pin('3.6.0'),
      after: pin('3.8.0'),
      notes: NOTES,
    });

    expect(out).toContain('The newest entry.');
    expect(out).toContain('The entry before it.');
    // ...but still not one from below the range.
    expect(out).not.toContain('An old entry, deliberately out of order.');
  });

  it('says nothing when the pin did not move', () => {
    expect(describeHop({ before: pin('3.8.0'), after: pin('3.8.0'), notes: NOTES })).toBe('');
  });

  it('says nothing when there is no pin to compare', () => {
    expect(describeHop({ before: null, after: pin('3.8.0'), notes: NOTES })).toBe('');
    expect(describeHop({ before: pin('3.7.0'), after: null, notes: NOTES })).toBe('');
  });
});
