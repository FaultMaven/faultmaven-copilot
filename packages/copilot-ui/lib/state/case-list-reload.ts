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
 * both call it, and so does every committed turn the transition effect does
 * not already re-read the list for (`turn-case-state.ts`, #321, #333): a bare
 * reload is served the cached page, which predates what the turn changed; and
 * a lazy case-create's completion, so the new case is listed even when the user
 * opened another one meanwhile (#334); and a turn refused because a delete of
 * its case is running (`CASE_DELETE_IN_PROGRESS`, both turn hooks), whose
 * re-read can land before the delete commits; and `refreshActiveCase` when the
 * case is gone (a 404, #384), the one fact about a case that needs no host to
 * judge it (in the Dashboard, a host with no sidebar, nothing reads the list).
 * Whether the user still DRIVES a case is the host's question, so
 * `refreshActiveCase` does not call it for that.
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
