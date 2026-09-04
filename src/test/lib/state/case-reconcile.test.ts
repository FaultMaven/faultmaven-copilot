import { describe, it, expect } from 'vitest';
import { isCaseTransition, CaseSnapshot } from '@faultmaven/copilot-ui/lib/state/case-reconcile';

const snap = (id: string | null, state: string | null): CaseSnapshot =>
  ({ id, state } as CaseSnapshot);

describe('isCaseTransition', () => {
  it('detects a same-case state change (turn-driven or out-of-band transition)', () => {
    expect(isCaseTransition(snap('a', 'investigating'), snap('a', 'resolved'))).toBe(true);
    expect(isCaseTransition(snap('a', 'inquiry'), snap('a', 'investigating'))).toBe(true);
  });

  it('treats a case switch as an observation, never a transition', () => {
    // This is the property that stops reconcile (cache invalidation + full
    // list refetch) from running on every case select.
    expect(isCaseTransition(snap('a', 'inquiry'), snap('b', 'closed'))).toBe(false);
  });

  it('does not fire on the first observation of a case', () => {
    expect(isCaseTransition(snap(null, null), snap('a', 'closed'))).toBe(false);
  });

  it('does not fire when nothing changed', () => {
    expect(isCaseTransition(snap('a', 'resolved'), snap('a', 'resolved'))).toBe(false);
  });

  it('does not fire when the active case is cleared', () => {
    expect(isCaseTransition(snap('a', 'resolved'), snap(null, null))).toBe(false);
  });
});
