/**
 * Whether an active-case change is still the composer's own case (#339).
 *
 * The composer's typed text and staged attachments belong to the case it was
 * opened on; any other change of the active case resets them, so nothing staged
 * in one case is sent to another. Three changes are the SAME case:
 *
 * - an optimistic `opt_case_*` id reconciled to its real id (`idMappingManager`);
 * - a new-case draft (`null`) becoming the case its own send created: the
 *   question path makes an optimistic case, the upload path a real one;
 * - that optimistic case rolled back to `null` when its creation failed.
 *
 * The last two happen only while the composer's own submission is in flight,
 * which is how they are told apart from the user opening a case from a draft
 * or starting a new one. A move from one real case to another is never the
 * composer's doing, in flight or not.
 */
import { idMappingManager } from '../optimistic';
import { isOptimisticId } from '../utils/data-integrity';

export function isSameComposerCase(
  prev: string | null,
  next: string | null,
  ownSubmissionInFlight: boolean,
): boolean {
  if (prev === next) return true;
  if (prev !== null && isOptimisticId(prev)) {
    if (next !== null && idMappingManager.getRealId(prev) === next) return true;
    if (next === null && ownSubmissionInFlight) return true;
  }
  return prev === null && ownSubmissionInFlight;
}
