/**
 * Whether an active-case change is still the composer's own case (#339).
 *
 * The composer's typed text and staged attachments belong to the case it was
 * opened on; any other change of the active case resets them, so nothing staged
 * in one case is sent to another. Three changes are the SAME case:
 *
 * - an optimistic `opt_case_*` id reconciled to its real id (`idMappingManager`);
 * - a new-case draft (`null`) becoming the lazy case its own send claimed
 *   (`claimLazyCase`: both send paths claim a fresh optimistic id when their
 *   create starts, #338);
 * - that claim rolled back to `null` when its create failed (`abandonLazyCase`).
 *
 * `ownClaims` holds the ids the composer's own sends claimed. A move to a case
 * none of them claimed, such as the user opening case B while the draft's
 * create is in flight, is another case: the input refused there (#318) belongs
 * to the draft, not to B. A move from one real case to another is never the
 * composer's doing.
 */
import { idMappingManager } from '../optimistic';
import { isOptimisticId } from '../utils/data-integrity';

export function isSameComposerCase(
  prev: string | null,
  next: string | null,
  ownClaims: ReadonlySet<string>,
): boolean {
  if (prev === next) return true;
  if (prev === null) return next !== null && ownClaims.has(next);
  if (isOptimisticId(prev)) {
    if (next === null) return ownClaims.has(prev);
    return idMappingManager.getRealId(prev) === next;
  }
  return false;
}
