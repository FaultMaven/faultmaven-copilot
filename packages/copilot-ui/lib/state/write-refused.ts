/**
 * The server said this viewer may not write the case (403).
 *
 * The ownership the client holds can be stale or not yet known — a placeholder
 * row before hydration, a case that changed hands. A 403 on a turn is the
 * server's own word, so this reads the case row back, and when that row names
 * another owner it marks the case denied (the panel then renders it read-only)
 * and leaves the shared-case notice in the bubble. When the row says the viewer
 * IS the owner the refusal is some other permission: the bubble says what the
 * server said, and the composer stays — a guess must not hide it.
 *
 * Shared by the two turn-sending paths (message and upload), so they cannot
 * disagree about what a refusal means.
 */
import type { OptimisticConversationItem } from '../optimistic';
import { isOwnedByOther, SHARED_READ_ONLY_NOTICE } from '../cases/ownership';
import { getEpoch } from './session-epoch';
import { useAppStore } from './store';

type SetConversations = (
  updater: (
    prev: Record<string, OptimisticConversationItem[]>,
  ) => Record<string, OptimisticConversationItem[]>,
) => void;

export function applyWriteRefused(args: {
  caseId: string;
  aiMessageId: string;
  fallbackText: string;
  epoch: number;
  setConversations: SetConversations;
}): void {
  const { caseId, aiMessageId, fallbackText, epoch, setConversations } = args;
  const setBubble = (text: string) =>
    setConversations((prev) => ({
      ...prev,
      [caseId]: (prev[caseId] || []).map((item) =>
        item.id === aiMessageId
          ? { ...item, response: text, optimistic: false, loading: false, error: true, failed: false }
          : item,
      ),
    }));

  setBubble(SHARED_READ_ONLY_NOTICE);
  void (async () => {
    await useAppStore.getState().refreshActiveCase(caseId);
    if (epoch !== getEpoch()) return;
    const state = useAppStore.getState();
    if (isOwnedByOther(state.activeCase, state.currentUser?.id)) {
      state.markWriteDenied(caseId);
    } else {
      setBubble(fallbackText);
    }
  })();
}
