/**
 * The panel's wiring for `applyCaseTitleChange`: the store, the `PUT`, and
 * what a failed write shows. Out of the JSX prop so it is testable; inside it,
 * reverting either failure arm left every test passing.
 */
import { updateCaseTitle } from '../api/services/case-service';
import { CaseTerminalError } from '../errors/types';
import type { CaseTitleChangeDeps } from './case-title-change';
import { useAppStore } from './store';

export function titleChangeDeps(
  showError: (error: unknown) => void,
  log?: CaseTitleChangeDeps['log'],
): CaseTitleChangeDeps {
  return {
    readStore: () => useAppStore.getState(),
    setConversationTitles: (updater) => useAppStore.getState().setConversationTitles(updater),
    setTitleSources: (updater) => useAppStore.getState().setTitleSources(updater),
    persistTitle: updateCaseTitle,
    // Only a 409 CASE_TERMINAL is shown as its own class. Every other failure
    // keeps the toast it had: passing any classified error through would turn
    // a 401's AuthenticationError into the blocking sign-in modal.
    onPersistError: (error) => showError(error instanceof CaseTerminalError ? error : {
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
    log,
  };
}
