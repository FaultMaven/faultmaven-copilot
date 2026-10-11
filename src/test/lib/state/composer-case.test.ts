/**
 * Which active-case changes are still the composer's own case (#339).
 *
 * The composer's staged input belongs to a case. A change of the active case
 * resets it, except where the "change" is the same case: an optimistic id
 * reconciled to its real id, or a case the composer's own send created (or
 * rolled back).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { idMappingManager } from '@faultmaven/copilot-ui/lib/optimistic';
import { isSameComposerCase } from '@faultmaven/copilot-ui/lib/state/composer-case';

describe('isSameComposerCase', () => {
  afterEach(() => idMappingManager.clear());

  it('the same id is the same case', () => {
    expect(isSameComposerCase('case-a', 'case-a', false)).toBe(true);
    expect(isSameComposerCase(null, null, false)).toBe(true);
  });

  it('another real case is another case, even during a send', () => {
    expect(isSameComposerCase('case-a', 'case-b', false)).toBe(false);
    expect(isSameComposerCase('case-a', 'case-b', true)).toBe(false);
  });

  it('leaving a case for a new one is another case', () => {
    expect(isSameComposerCase('case-a', null, false)).toBe(false);
  });

  it('an optimistic id reconciled to its real id is the same case, with or without a send in flight', () => {
    idMappingManager.addMapping('opt_case_1', 'case-real');
    expect(isSameComposerCase('opt_case_1', 'case-real', false)).toBe(true);
    expect(isSameComposerCase('opt_case_1', 'case-real', true)).toBe(true);
  });

  it('an optimistic id moving to an unrelated case is another case', () => {
    idMappingManager.addMapping('opt_case_1', 'case-real');
    expect(isSameComposerCase('opt_case_1', 'case-b', false)).toBe(false);
  });

  it('a new case created by the composer’s own send is the same case', () => {
    expect(isSameComposerCase(null, 'opt_case_2', true)).toBe(true);
    expect(isSameComposerCase(null, 'case-new', true)).toBe(true);
  });

  it('opening a case from a new-case draft, with no send in flight, is another case', () => {
    expect(isSameComposerCase(null, 'case-b', false)).toBe(false);
  });

  it('a failed case-create rolled back during the composer’s own send is the same case', () => {
    expect(isSameComposerCase('opt_case_3', null, true)).toBe(true);
    expect(isSameComposerCase('opt_case_3', null, false)).toBe(false);
  });
});
