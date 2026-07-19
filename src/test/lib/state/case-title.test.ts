import { describe, it, expect } from 'vitest';
import { selectCaseTitle } from '~lib/state/case-title';

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
