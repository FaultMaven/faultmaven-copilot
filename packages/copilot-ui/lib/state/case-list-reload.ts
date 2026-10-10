/**
 * Take a case the user no longer drives out of the sidebar (ADR-020 D8).
 *
 * The sidebar lists the cases its user drives, and its first page may be held
 * in the single-slot list cache. When something learns that the user no longer
 * drives a case — a 403 read-back, or the open case's row naming another
 * driver — the slot is dropped FIRST and the list asked to reload SECOND, so
 * the reload reads the server's `access=write` answer instead of the cached
 * page that still lists the case. A sidebar fetch already in flight cannot
 * refill the slot with its older page: `invalidateCache` moves the cache's
 * generation, and that fetch's write is refused (`case-cache.ts`).
 *
 * `epoch` is the session the caller learned it in. A sign-out between the two
 * steps leaves the new session's list alone.
 *
 * The one copy of the sequence: the 403 path (`write-refused.ts`) and the
 * extension host (when its open case turns out to be driven by someone else)
 * both call it. It is NOT called from `refreshActiveCase`, which also runs in
 * the Dashboard, a host with no sidebar.
 */
import { caseCacheManager } from '../cache/case-cache';
import { getEpoch } from './session-epoch';
import { useAppStore } from './store';

export async function reloadDrivenCaseList(epoch: number): Promise<void> {
  if (epoch !== getEpoch()) return;
  await caseCacheManager.invalidateCache();
  if (epoch !== getEpoch()) return;
  useAppStore.getState().triggerRefreshSessions();
}
