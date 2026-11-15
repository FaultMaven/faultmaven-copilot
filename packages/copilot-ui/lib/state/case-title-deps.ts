/**
 * The panel's wiring for `applyCaseTitleChange`: the store, the `PUT`, and
 * what a failed write shows. Out of the JSX prop so it is testable; inside it,
 * reverting either failure arm left every test passing.
 */
import { updateCaseTitle } from '../api/services/case-service';
import { CaseNotFoundError, CaseTerminalError } from '../errors/types';
import type { CaseTitleChangeDeps } from './case-title-change';
import { getEpoch } from './session-epoch';
import { useAppStore } from './store';
import { readBackRefusedWrite } from './write-refused';

export function titleChangeDeps(
  showError: (error: unknown) => void,
  log?: CaseTitleChangeDeps['log'],
): CaseTitleChangeDeps {
  // Built per change, as the write starts: a read-back after a sign-out
  // during the write acts on nothing.
  const epoch = getEpoch();
  return {
    readStore: () => useAppStore.getState(),
    setConversationTitles: (updater) => useAppStore.getState().setConversationTitles(updater),
    setTitleSources: (updater) => useAppStore.getState().setTitleSources(updater),
    persistTitle: updateCaseTitle,
    // Only a 409 CASE_TERMINAL and a case found gone are shown as their own
    // class. Every other failure keeps the toast it had: passing any
    // classified error through would turn a 401's AuthenticationError into the
    // blocking sign-in modal.
    onPersistError: (error) => showError(error instanceof CaseTerminalError || error instanceof CaseNotFoundError ? error : {
      title: 'Failed to update title',
      message: error instanceof Error ? error.message : 'Unknown error',
      type: 'error'
    }),
    // The active case's row is read back; the list is refetched too, so a
    // renamed case that is not the active one moves to its closed group.
    refreshCase: (caseId) => {
      const state = useAppStore.getState();
      void state.refreshActiveCase(caseId);
      state.triggerRefreshSessions();
    },
    readBackRefusal: (caseId) => readBackRefusedWrite(caseId, epoch),
    log,
  };
}
