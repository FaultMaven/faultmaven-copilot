/**
 * A case created lazily, by the first message or upload on a new chat (#334).
 *
 * The create takes a round-trip, and the user can go elsewhere meanwhile: open
 * another case from the sidebar, or start another new chat. So the create is
 * given an identity of its own when it starts: a fresh optimistic case id, set
 * as the active case (`claimLazyCase`). The panel is still where the create
 * left it exactly when the active case is still that id. A comparison with the
 * active id the create started from cannot tell: that is usually `null`, and a
 * user who opened case B and then a new chat is back on `null` without being on
 * this create's chat.
 *
 * When the create lands (`landLazyCase`), the optimistic id is reconciled to
 * the real one everywhere it lives, whichever case is open; the panel moves to
 * the new case only while it still shows the optimistic one. The new case
 * reaches the sidebar either way, through `reloadDrivenCaseList` (drop the
 * slot, then reload): it is on no cached page, and if its turn fails no
 * post-turn read will list it. A failed create (`abandonLazyCase`) rolls back
 * only its own pointer.
 *
 * Shared by the two turn-sending paths (message and upload), which each send
 * their own create request.
 */
import type { UserCase } from '../../types/case';
import { idMappingManager, OptimisticIdGenerator } from '../optimistic';
import { createLogger } from '../utils/logger';
import { reloadDrivenCaseList } from './case-list-reload';
import { useAppStore } from './store';

const log = createLogger('lazy-case');

/** Point the panel at a case about to be created; returns its optimistic id. */
export function claimLazyCase(): string {
  const optimisticId = OptimisticIdGenerator.generateCaseId();
  const store = useAppStore.getState();
  void store.setActiveCaseId(optimisticId);
  store.setHasUnsavedNewChat(false);
  return optimisticId;
}

/**
 * The create for `optimisticId` returned `newCase`. Called after the caller's
 * session-epoch check, with that same `epoch`.
 */
export async function landLazyCase(optimisticId: string, newCase: UserCase, epoch: number): Promise<void> {
  const realCaseId = newCase.case_id;
  const store = useAppStore.getState();
  idMappingManager.addMapping(optimisticId, realCaseId);

  // Every write from here to the pointer's storage write is synchronous, so a
  // logout cannot land between them.
  store.setConversations(prev => {
    const optimisticConversation = prev[optimisticId];
    if (!optimisticConversation) return prev;

    const updated = { ...prev };
    delete updated[optimisticId];
    updated[realCaseId] = optimisticConversation;
    return updated;
  });

  store.setConversationTitles(prev => {
    const optimisticTitle = prev[optimisticId];
    if (optimisticId === realCaseId || !optimisticTitle) return prev;

    // Carry a title the user set on the optimistic case over to the real id —
    // and nothing else. This used to write `newCase.title`, which for a
    // just-created case is the backend placeholder `Case-YYMMDD-N`. Because
    // the store wins over the backend title in `selectCaseTitle`, that pinned
    // the placeholder ahead of the real title the server writes moments later,
    // and the sidebar kept showing `Case-YYMMDD-N` for a case that had been
    // named (fm#1069). With no entry, the backend title renders.
    const updated = { ...prev };
    updated[realCaseId] = optimisticTitle;
    delete updated[optimisticId];
    return updated;
  });

  store.setTitleSources(prev => {
    const optimisticSource = prev[optimisticId];
    if (!optimisticSource) return prev;

    const updated = { ...prev };
    delete updated[optimisticId];
    if (optimisticSource === 'user') {
      updated[realCaseId] = optimisticSource;
    }
    return updated;
  });

  // The row and pointer switch together, so neither is ever another case's.
  if (useAppStore.getState().activeCaseId === optimisticId) {
    store.setActiveCase(newCase);
    await store.setActiveCaseId(realCaseId);
  } else {
    log.info('Case created after the user left it; leaving the open case alone', {
      optimisticId,
      realCaseId,
    });
  }

  log.info('Case ID reconciliation completed', { optimisticId, realCaseId });
  void reloadDrivenCaseList(epoch);
}

/**
 * The create for `optimisticId` failed: no mapping exists, and an active id
 * left on it would make the next submit POST a turn against an optimistic id.
 * Clear it (which also removes `faultmaven_current_case`) and reopen the new
 * chat composer, but only while the panel still shows it.
 */
export async function abandonLazyCase(optimisticId: string): Promise<void> {
  const store = useAppStore.getState();
  if (store.activeCaseId !== optimisticId) return;
  await store.setActiveCaseId(null);
  store.setHasUnsavedNewChat(true);
}
