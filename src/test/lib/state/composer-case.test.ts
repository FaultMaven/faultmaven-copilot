/**
 * Which active-case changes are still the composer's own case (#339).
 *
 * The composer's staged input belongs to a case. A change of the active case
 * resets it, except where the "change" is the same case: an optimistic id
 * reconciled to its real id, or the lazy case the composer's own send claimed
 * (`claimLazyCase`, #338), or that claim rolled back.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { idMappingManager } from '@faultmaven/copilot-ui/lib/optimistic';
import { isSameComposerCase } from '@faultmaven/copilot-ui/lib/state/composer-case';

const none: ReadonlySet<string> = new Set();
const claimed = (...ids: string[]): ReadonlySet<string> => new Set(ids);

describe('isSameComposerCase', () => {
  afterEach(() => idMappingManager.clear());

  it('the same id is the same case', () => {
    expect(isSameComposerCase('case-a', 'case-a', none)).toBe(true);
    expect(isSameComposerCase(null, null, none)).toBe(true);
  });

  it('another real case is another case, whatever the composer claimed', () => {
    expect(isSameComposerCase('case-a', 'case-b', none)).toBe(false);
    expect(isSameComposerCase('case-a', 'case-b', claimed('opt_case_1'))).toBe(false);
  });

  it('leaving a case for a new one is another case', () => {
    expect(isSameComposerCase('case-a', null, none)).toBe(false);
  });

  it('an optimistic id reconciled to its real id is the same case', () => {
    idMappingManager.addMapping('opt_case_1', 'case-real');
    expect(isSameComposerCase('opt_case_1', 'case-real', none)).toBe(true);
  });

  it('an optimistic id moving to an unrelated case is another case', () => {
    idMappingManager.addMapping('opt_case_1', 'case-real');
    expect(isSameComposerCase('opt_case_1', 'case-b', claimed('opt_case_1'))).toBe(false);
  });

  it('a new-case draft becoming the lazy case its own send claimed is the same case', () => {
    expect(isSameComposerCase(null, 'opt_case_2', claimed('opt_case_2'))).toBe(true);
  });

  it('a draft moving to any case its send did not claim is another case', () => {
    // The leak: the user opens case B while the draft's create is in flight.
    expect(isSameComposerCase(null, 'case-b', claimed('opt_case_2'))).toBe(false);
    expect(isSameComposerCase(null, 'opt_case_other', claimed('opt_case_2'))).toBe(false);
    expect(isSameComposerCase(null, 'case-b', none)).toBe(false);
  });

  it('its own claim rolled back is the same case; anyone else’s is not', () => {
    expect(isSameComposerCase('opt_case_3', null, claimed('opt_case_3'))).toBe(true);
    expect(isSameComposerCase('opt_case_3', null, none)).toBe(false);
  });
});
