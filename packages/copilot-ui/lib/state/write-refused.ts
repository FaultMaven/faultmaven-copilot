/**
 * The server said this viewer may not write the case (403).
 *
 * The driver the client holds can be stale or not yet known — a placeholder
 * row before hydration, a case reassigned to someone else while it was open
 * (ADR-020). A 403 on a turn is the server's own word, so this reads the case
 * row back, and when that row names another driver it marks the case denied
 * (the panel then renders it read-only), leaves the read-only notice in the
 * bubble, and takes the case out of the sidebar's list: the list is the cases
 * this user drives, and this one no longer is. When the row says the viewer
 * IS the driver the refusal is some other permission: the bubble says what the
 * server said, and the composer stays — a guess must not hide it.
 *
 * Shared by the two turn-sending paths (message and upload), so they cannot
 * disagree about what a refusal means.
 */
import type { OptimisticConversationItem } from '../optimistic';
import { caseCacheManager } from '../cache/case-cache';
import { CHECKING_ACCESS_NOTICE, DRIVER_READ_ONLY_NOTICE, isDrivenByOther } from '../cases/driver';
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

  // Claim nothing until the row says who drives the case.
  setBubble(CHECKING_ACCESS_NOTICE);
  void (async () => {
    // Judged on the row fetched for THE REFUSED case, never on whatever case is
    // open when the read lands: the user may have moved to another one.
    const row = await useAppStore.getState().refreshActiveCase(caseId);
    if (epoch !== getEpoch()) return;
    const state = useAppStore.getState();
    if (row && isDrivenByOther(row, state.currentUser?.id)) {
      state.markWriteDenied(caseId);
      setBubble(DRIVER_READ_ONLY_NOTICE);
      // The sidebar lists the cases this user drives. Its cached page still
      // holds this one, so drop the slot BEFORE asking the list to reload:
      // the reload then reads the server's `access=write` answer, which no
      // longer has it, instead of the cached page that does.
      await caseCacheManager.invalidateCache();
      if (epoch !== getEpoch()) return;
      useAppStore.getState().triggerRefreshSessions();
    } else {
      setBubble(fallbackText);
    }
  })();
}
