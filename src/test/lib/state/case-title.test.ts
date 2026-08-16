import { describe, it, expect } from 'vitest';
import { selectCaseTitle, isPlaceholderCaseTitle } from '~lib/state/case-title';

describe('selectCaseTitle', () => {
  it('prefers the store title over the backend title', () => {
    expect(
      selectCaseTitle({ store: 'Renamed', backend: 'Case-0719-1' }, 'Untitled Case')
    ).toBe('Renamed');
  });

  it('falls back to the backend title when the store has no entry', () => {
    expect(
      selectCaseTitle({ store: undefined, backend: 'Case-0719-1' }, 'Untitled Case')
    ).toBe('Case-0719-1');
  });

  it('uses the fallback when neither source has content', () => {
    expect(selectCaseTitle({ store: undefined, backend: undefined }, 'Loading…')).toBe('Loading…');
    expect(selectCaseTitle({ store: '', backend: '' }, 'Untitled Case')).toBe('Untitled Case');
  });

  it('treats a whitespace-only store title as empty and falls through', () => {
    expect(
      selectCaseTitle({ store: '   ', backend: 'Case-0719-1' }, 'Untitled Case')
    ).toBe('Case-0719-1');
  });

  it('returns the winning title verbatim (does not trim it)', () => {
    expect(selectCaseTitle({ store: '  My Case  ' }, 'Untitled Case')).toBe('  My Case  ');
  });

  it('regression: renaming one case never reverts another case\'s title', () => {
    // Each case resolves against its OWN store entry through the single selector,
    // so a rename of case A cannot affect the title resolved for case B — the
    // divergent-mirror reversion bug (#131) cannot recur.
    const store: Record<string, string> = { A: 'Old A', B: 'Generated B' };
    const backend: Record<string, string> = { A: 'Case-0719-1', B: 'Case-0719-2' };

    const titleFor = (id: string) =>
      selectCaseTitle({ store: store[id], backend: backend[id] }, 'Untitled Case');

    expect(titleFor('B')).toBe('Generated B');

    // User renames A; only A's store entry changes.
    store.A = 'Renamed A';

    expect(titleFor('A')).toBe('Renamed A');
    expect(titleFor('B')).toBe('Generated B'); // unaffected
  });
});

/**
 * fm#1069: a placeholder pinned in the store shadowed the server-generated title.
 *
 * The store wins over the backend title, and several paths seeded it with
 * whatever the backend last reported — including the `Case-YYMMDD-N` a case is
 * born with. Fixing the writers is not enough on its own: `conversationTitles`
 * is persisted to `browser.storage.local`, so an entry written by an older build
 * outlives the code that wrote it and keeps winning after upgrade. The selector
 * is where that is answered, because it is the only thing every read goes
 * through.
 */
describe('selectCaseTitle — placeholder titles never win', () => {
  it('falls through to the backend title when the store holds a placeholder', () => {
    expect(
      selectCaseTitle(
        { store: 'Case-260816-1', backend: 'Postgres pool exhaustion' },
        'Untitled Case'
      )
    ).toBe('Postgres pool exhaustion');
  });

  it('also skips the pre-2026-01-28 four-digit placeholder form', () => {
    // Entries persisted by builds from before the generator became year-safe.
    expect(
      selectCaseTitle(
        { store: 'Case-1106-1', backend: 'Kafka consumer lag' },
        'Untitled Case'
      )
    ).toBe('Kafka consumer lag');
  });

  it('still shows a placeholder when that is genuinely all there is', () => {
    // Skipping the store must not degrade a case the server has not named yet.
    expect(
      selectCaseTitle({ store: 'Case-260816-1', backend: 'Case-260816-1' }, 'Untitled Case')
    ).toBe('Case-260816-1');
    expect(selectCaseTitle({ store: 'Case-260816-1' }, 'Untitled Case')).toBe('Untitled Case');
  });

  it('keeps honouring a real stored title over the backend', () => {
    // The store's actual purpose — an optimistic user rename — is untouched.
    expect(
      selectCaseTitle({ store: 'My own name', backend: 'Server name' }, 'Untitled Case')
    ).toBe('My own name');
  });

  it('does not mistake a real title that merely contains the shape', () => {
    expect(
      selectCaseTitle(
        { store: 'Re: Case-260101-1', backend: 'Server name' },
        'Untitled Case'
      )
    ).toBe('Re: Case-260101-1');
    expect(
      selectCaseTitle(
        { store: 'Case-260101-1 follow-up', backend: 'Server name' },
        'Untitled Case'
      )
    ).toBe('Case-260101-1 follow-up');
  });
});

describe('isPlaceholderCaseTitle', () => {
  it.each(['Case-260816-1', 'Case-1106-1', 'Case-991231-999', '  Case-260101-1  '])(
    'recognises %s',
    (title) => expect(isPlaceholderCaseTitle(title)).toBe(true)
  );

  it.each([
    'Postgres pool exhaustion',
    'Re: Case-260101-1',
    'Case-260101-1 follow-up',
    'Case-26011-1',
    'Case-260101',
    'case-260101-1',
    '',
    null,
    undefined
  ])('leaves %s alone', (title) => expect(isPlaceholderCaseTitle(title as any)).toBe(false));
});
