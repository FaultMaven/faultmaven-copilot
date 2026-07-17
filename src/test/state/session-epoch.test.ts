import { describe, it, expect } from 'vitest';
import { getEpoch, bumpEpoch } from '../../lib/state/session-epoch';

describe('session-epoch', () => {
  it('bumpEpoch strictly increases and getEpoch reflects it', () => {
    const start = getEpoch();

    const afterFirst = bumpEpoch();
    expect(afterFirst).toBe(start + 1);
    expect(getEpoch()).toBe(afterFirst);

    const afterSecond = bumpEpoch();
    expect(afterSecond).toBe(afterFirst + 1);
    expect(getEpoch()).toBe(afterSecond);
  });

  it('is monotonic — a value captured before a bump never re-matches', () => {
    const captured = getEpoch();
    bumpEpoch();
    // The guard pattern the whole fence relies on.
    expect(captured !== getEpoch()).toBe(true);

    // Even after many further bumps it can never equal the captured value again.
    for (let i = 0; i < 5; i++) bumpEpoch();
    expect(getEpoch()).toBeGreaterThan(captured);
  });
});
