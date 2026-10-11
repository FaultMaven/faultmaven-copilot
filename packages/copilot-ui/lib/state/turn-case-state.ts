/**
 * What a committed turn changes outside its own rows: the open case's state,
 * and the sidebar's list.
 *
 * A turn's `case_state` belongs to the case the turn was sent for (#321). In
 * the extension the user can open another case from the sidebar while a turn
 * is in flight, so the case open when the response lands need not be the
 * turn's. Writing the state onto whatever is open put case A's state on case B
 * (B read `resolved` because A resolved), and the panel's transition effect
 * then reconciled B and told the host B had changed. The state is applied only
 * to an open row that IS the turn's case; the open row may still carry the
 * optimistic id the turn's real id was reconciled from (`idMappingManager`),
 * so that counts as the turn's case.
 *
 * The sidebar is then re-read exactly once, so it shows what the turn changed
 * on the server: a new state, and a title the server gave a placeholder case
 * while answering (fm#1069; it is persisted before the turn's response, so a
 * read after the response sees it). When the open case's state changed,
 * SidePanelApp's transition effect does that (`reconcileActiveCaseState`).
 * Otherwise it happens here, through `reloadDrivenCaseList`: the slot is dropped
 * FIRST, because a reload that only asks the list again is served the cached
 * page, which can be minutes old (#333). That also covers a turn whose case is
 * no longer open, whose row only the sidebar shows.
 *
 * A turn that committed without a reply it could serve
 * (`IDEMPOTENCY_REPLAY_UNAVAILABLE`) has no `case_state` in hand. Its state
 * comes from the case row read back (`refreshActiveCase`, which merges it only
 * into an open row that is the turn's case), and the list is re-read the same
 * one way (`applyUnrepliedTurn`).
 *
 * Shared by the two turn-sending paths (message and upload), so they cannot
 * disagree about which case a response is about.
 */
import type { UserCase } from '../../types/case';
import { idMappingManager } from '../optimistic';
import { isOptimisticId } from '../utils/data-integrity';
import { createLogger } from '../utils/logger';
import { reloadDrivenCaseList } from './case-list-reload';
import { getEpoch } from './session-epoch';
import { useAppStore } from './store';

const log = createLogger('turn-case-state');

function isTurnCase(openId: string | null | undefined, caseId: string): boolean {
  if (!openId) return false;
  if (openId === caseId) return true;
  return isOptimisticId(openId) && idMappingManager.getRealId(openId) === caseId;
}

/**
 * Apply a committed turn to the open case and the sidebar. Called after the
 * caller's session-epoch check, with that same `epoch`.
 */
export function applyTurnCaseState(
  caseId: string,
  caseState: string | null | undefined,
  epoch: number,
): void {
  let stateChanged = false;

  if (caseState) {
    useAppStore.getState().setActiveCase((prev: UserCase | null) => {
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

  // The transition effect re-reads the list for a state change; a second
  // reload here would spend two list GETs to answer one question.
  if (stateChanged) return;

  if (!isTurnCase(useAppStore.getState().activeCaseId, caseId)) {
    log.info('Turn landed on a case that is no longer open', { caseId, caseState });
  }
  void reloadDrivenCaseList(epoch);
}

/**
 * A turn committed but its reply cannot be served: read its rows and its case
 * row back, and re-read the list once. Called after the caller's
 * session-epoch check, with that same `epoch`.
 */
export async function applyUnrepliedTurn(
  caseId: string,
  rowIds: readonly string[],
  epoch: number,
): Promise<void> {
  const store = useAppStore.getState();
  void store.reloadCommittedTurn(caseId, rowIds);

  const openTurnCaseState = () => {
    const open = useAppStore.getState().activeCase;
    return open && isTurnCase(open.case_id, caseId) ? open.state : null;
  };
  const before = openTurnCaseState();
  await store.refreshActiveCase(caseId);
  if (epoch !== getEpoch()) return;

  // The read-back moved the open case's state: the transition effect re-reads
  // the list for that, as it does for a reply's `case_state`.
  const after = openTurnCaseState();
  if (before !== null && after !== null && before !== after) return;

  void reloadDrivenCaseList(epoch);
}
