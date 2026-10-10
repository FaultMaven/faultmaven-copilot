import { describe, it, expect } from 'vitest';
import { isCreatedBy, isDrivenByOther } from '@faultmaven/copilot-ui/lib/cases/driver';

describe('isDrivenByOther — only the case driver writes (ADR-020, fm#1898)', () => {
  it('a case another user drives is read-only', () => {
    expect(isDrivenByOther({ driver_id: 'u2' }, 'u1')).toBe(true);
  });

  it('a case the viewer drives is writable', () => {
    expect(isDrivenByOther({ driver_id: 'u1' }, 'u1')).toBe(false);
  });

  // Ids only: a name or an email is never what `cases.driver_id` holds.
  it('compares ids exactly, not case-folded or trimmed', () => {
    expect(isDrivenByOther({ driver_id: 'U1' }, 'u1')).toBe(true);
  });

  // The creator who handed the case on is a reader like any other.
  it('is judged on the driver, not the creator', () => {
    expect(isDrivenByOther({ driver_id: 'u2', owner_id: 'u1' } as never, 'u1')).toBe(true);
    expect(isDrivenByOther({ driver_id: 'u1', owner_id: 'u2' } as never, 'u1')).toBe(false);
  });

  // The placeholder row (before hydration) and a locally created case name no
  // driver; calling those read-only would hide the composer from the driver.
  it.each([
    ['no driver on the row', { driver_id: '' }, 'u1'],
    ['a null driver', { driver_id: null }, 'u1'],
    ['no row', null, 'u1'],
    ['no viewer', { driver_id: 'u2' }, undefined],
  ])('unknown is writable: %s', (_label, row, viewer) => {
    expect(isDrivenByOther(row, viewer)).toBe(false);
  });
});

describe('isCreatedBy — the creator holds delete', () => {
  it('the creator', () => {
    expect(isCreatedBy({ owner_id: 'u1' }, 'u1')).toBe(true);
  });

  it('another user, the driver included', () => {
    expect(isCreatedBy({ owner_id: 'u2' }, 'u1')).toBe(false);
  });

  it.each([
    ['no creator on the row', { owner_id: '' }, 'u1'],
    ['no row', null, 'u1'],
    ['no viewer', { owner_id: 'u1' }, undefined],
  ])('unknown is not the creator: %s', (_label, row, viewer) => {
    expect(isCreatedBy(row, viewer)).toBe(false);
  });
});
