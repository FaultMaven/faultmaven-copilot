import { describe as vitestDescribe, it, expect, vi } from 'vitest';

// The module under test is a plain ESM script with no dependencies, which is
// why #268 factored `describe` out of the fetching — "so it is testable". It
// then shipped with no test, and was wrong on its first real bump.
// @ts-expect-error — a .mjs script with no type declarations.
import { describe as describeHop, fetchNotes } from '../../../scripts/report-contract-hop.mjs';

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

  it('reports every entry a multi-contract hop actually crossed, AND says it is several', () => {
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

    // THE HEADING, not just the entry text. Asserting only that both texts
    // appear leaves the branch itself untested: collapse the multi arm into the
    // single arm and a two-contract bump renders under "One contract adopted"
    // with every other assertion here still green — the disclosure defeated in
    // exactly the way this file exists to prevent, one branch over.
    expect(out).toMatch(/2 contracts adopted, not one/);
    expect(out).not.toContain('One contract adopted');
  });

  it('prints the NEWEST entry first, not file order and not oldest first', () => {
    // The notes are deliberately out of order (see NOTES above), so walking
    // the file emits them that way. Measured on the real 6.2.0 -> 9.0.0 hop:
    // 8.0.0, 7.2.0, 7.1.0, 7.0.0, 9.0.0 — the newest MAJOR last, behind a
    // 16,241-character entry.
    //
    // ‼ ASCENDING does not fix that, and was the first attempt: it left the
    // newest entry last anyway and moved the 16k one to the FRONT. The
    // property is "newest first", so that is what this asserts.
    //
    // ‼ The oracle is EXPLICIT, not `[...order].sort()`. Array sort is
    // LEXICAL and the code compares NUMERICALLY — the distinction
    // `parseVersion` exists for — so a self-comparing oracle cannot tell the
    // two apart, and would demand '10.0.0' before '9.0.0'.
    // ‼ The fixture's FILE order must not already be newest-first, or "no
    // sort at all" passes this test — which is what happened on the first
    // attempt: NOTES is written 3.8.0, 3.7.0, 2.0.0, so deleting the sort
    // entirely stayed green. This one puts the newest LAST in the file.
    const OUT_OF_ORDER = [
      '# 2.0.0 — MAJOR. The oldest, written first.',
      '# Its second line.',
      '',
      '# 3.8.0 — MINOR. The newest, written last.',
      '# Its second line.',
      '',
      'API_CONTRACT_VERSION = "3.8.0"',
    ].join('\n');

    const out = describeHop({
      before: pin('1.0.0'),
      after: pin('3.8.0'),
      notes: OUT_OF_ORDER,
    });
    const order = [...out.matchAll(/(\d+\.\d+\.\d+) — /g)].map((m) => m[1]);
    expect(order).toEqual(['3.8.0', '2.0.0']);
  });

  it('orders NUMERICALLY, not lexically', () => {
    // The real contract is at 9.0.0 today, so 10.x is the next hop that can
    // exist — and it is the one a lexical comparison gets wrong, placing
    // '10.0.0' before '9.0.0'. Pinned before it can happen rather than after.
    const TWO_DIGIT = [
      '# 10.0.0 — MAJOR. The one after nine.',
      '# Its second line.',
      '',
      '# 9.0.0 — MAJOR. Nine.',
      '# Its second line.',
      '',
      'API_CONTRACT_VERSION = "10.0.0"',
    ].join('\n');

    const out = describeHop({
      before: pin('8.0.0'),
      after: pin('10.0.0'),
      notes: TWO_DIGIT,
    });
    const order = [...out.matchAll(/(\d+\.\d+\.\d+) — /g)].map((m) => m[1]);
    expect(order).toEqual(['10.0.0', '9.0.0']);
  });

  it('reads CRLF notes as cleanly as LF', () => {
    // `contract_version.py` is read over the network; a CRLF checkout or a
    // proxy rewriting line endings would otherwise leave a carriage return on
    // every emitted line. Every other fixture here joins with '\n', so nothing
    // else in this file can tell the two apart.
    const out = describeHop({
      before: pin('3.7.0'),
      after: pin('3.8.0'),
      notes: NOTES.replace(/\n/g, '\r\n'),
    });
    expect(out).toContain('3.8.0 — MINOR. The newest entry.');
    expect(out).not.toContain('\r');
  });

  it('warns rather than goes quiet when the pin moved but no entry matched', () => {
    // Silence and confidence are the two outputs this must never produce by
    // accident, and a version with no note in the file is the way to get the
    // first one: the bump is real, and the reader learns nothing about it.
    const out = describeHop({
      before: pin('3.8.0'),
      after: pin('9.9.9'),
      notes: NOTES,
    });

    expect(out).not.toBe('');
    expect(out).toMatch(/9\.9\.9/);
  });

  it('says nothing when the pin did not move', () => {
    expect(describeHop({ before: pin('3.8.0'), after: pin('3.8.0'), notes: NOTES })).toBe('');
  });

  it('says nothing when there is no pin to compare', () => {
    expect(describeHop({ before: null, after: pin('3.8.0'), notes: NOTES })).toBe('');
    expect(describeHop({ before: pin('3.7.0'), after: null, notes: NOTES })).toBe('');
  });

  vitestDescribe('fetching the notes', () => {
    const PIN = {
      repository: 'FaultMaven/faultmaven',
      ref: 'a'.repeat(40),
      contractVersion: '9.0.0',
    };

    it('DRAINS a non-ok body, or the process never exits', async () => {
      // Measured: three un-drained 503s hang `node` until killed, because an
      // un-consumed body keeps the socket alive. `continue-on-error` forgives
      // a non-zero exit, not a hang.
      const cancel = vi.fn().mockResolvedValue(undefined);
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: false, status: 503, body: { cancel } });
      vi.stubGlobal('fetch', fetchMock);

      await fetchNotes(PIN);

      expect(cancel).toHaveBeenCalledTimes(fetchMock.mock.calls.length);
      vi.unstubAllGlobals();
    });

    it('RETRIES a 403, which is one of GitHub\'s rate-limit statuses', async () => {
      // Treating every non-429 4xx as an answer drops the retry in precisely
      // the case a retry is for.
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 403, body: null })
        .mockResolvedValueOnce({ ok: true, text: async () => '# 9.0.0 — MAJOR. Ok.' });
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchNotes(PIN)).resolves.toContain('9.0.0');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      vi.unstubAllGlobals();
    });

    it('does NOT retry a 404 — a missing ref is an answer', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue({ ok: false, status: 404, body: null });
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchNotes(PIN)).resolves.toBe('');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });
  });
});
