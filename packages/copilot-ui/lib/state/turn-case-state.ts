/**
 * A turn's `case_state` belongs to the case the turn was sent for (#321).
 *
 * In the extension the user can open another case from the sidebar while a
 * turn is in flight, so the case open when the response lands need not be the
 * turn's. Writing the state onto whatever is open put case A's state on case B
 * (B read `resolved` because A resolved), and the panel's transition effect
 * then reconciled B and told the host B had changed. The state is applied only
 * to an open row that IS the turn's case; otherwise nothing open changes, and
 * the turn's case is out of sight in the sidebar, whose cached row for it is
 * now stale: the slot is dropped and the list reloaded (`reloadDrivenCaseList`).
 *
 * The open row may still carry the optimistic id the turn's real id was
 * reconciled from (`idMappingManager`), so that counts as the turn's case.
 *
 * Shared by the two turn-sending paths (message and upload), so they cannot
 * disagree about which case a response is about.
 */
import type { UserCase } from '../../types/case';
import { idMappingManager } from '../optimistic';
import { isOptimisticId } from '../utils/data-integrity';
import { createLogger } from '../utils/logger';
import { reloadDrivenCaseList } from './case-list-reload';
import { useAppStore } from './store';

const log = createLogger('turn-case-state');

function isTurnCase(openId: string | null | undefined, caseId: string): boolean {
  if (!openId) return false;
  if (openId === caseId) return true;
  return isOptimisticId(openId) && idMappingManager.getRealId(openId) === caseId;
}

export interface TurnCaseStateResult {
  /** The open case is the turn's and the turn moved it to a new state. */
  stateChanged: boolean;
  /**
   * The sidebar's list is already being reloaded (the turn's case is not the
   * open one), so the caller's post-turn refresh would ask for it twice.
   */
  listReloaded: boolean;
}

/**
 * Apply a committed turn's `case_state` to the case it was sent for. Called
 * after the caller's session-epoch check, with that same `epoch`.
 */
export function applyTurnCaseState(
  caseId: string,
  caseState: string | null | undefined,
  epoch: number,
): TurnCaseStateResult {
  const store = useAppStore.getState();
  let stateChanged = false;

  if (caseState) {
    store.setActiveCase((prev: UserCase | null) => {
      if (!prev || !isTurnCase(prev.case_id, caseId) || prev.state === caseState) return prev;
      log.info('Updating active case status from backend', {
        caseId,
        oldStatus: prev.state,
        newStatus: caseState,
      });
      stateChanged = true;
      return { ...prev, state: caseState as UserCase['state'] };
    });
  }

  if (isTurnCase(useAppStore.getState().activeCaseId, caseId)) {
    return { stateChanged, listReloaded: false };
  }

  log.info('Turn landed on a case that is no longer open; reloading the case list', {
    caseId,
    caseState,
  });
  void reloadDrivenCaseList(epoch);
  return { stateChanged, listReloaded: true };
}
