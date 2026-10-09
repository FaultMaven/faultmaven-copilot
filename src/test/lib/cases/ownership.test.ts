import { describe, it, expect } from 'vitest';
import { isOwnedByOther } from '@faultmaven/copilot-ui/lib/cases/ownership';

describe('isOwnedByOther — a team share is read-only (fm#1898)', () => {
  it('a case another user owns is someone else’s', () => {
    expect(isOwnedByOther({ owner_id: 'u2' }, 'u1')).toBe(true);
  });

  it('the viewer’s own case is writable', () => {
    expect(isOwnedByOther({ owner_id: 'u1' }, 'u1')).toBe(false);
  });

  // Ids only: a name or an email is never what `cases.user_id` holds.
  it('compares ids exactly, not case-folded or trimmed', () => {
    expect(isOwnedByOther({ owner_id: 'U1' }, 'u1')).toBe(true);
  });

  // The placeholder row (before hydration) and a locally created case name no
  // owner; calling those read-only would hide the composer from the owner.
  it.each([
    ['no owner on the row', { owner_id: '' }, 'u1'],
    ['no row', null, 'u1'],
    ['no viewer', { owner_id: 'u2' }, undefined],
  ])('unknown is writable: %s', (_label, row, viewer) => {
    expect(isOwnedByOther(row, viewer)).toBe(false);
  });
});
