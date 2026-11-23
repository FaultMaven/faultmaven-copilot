/**
 * A case being deleted: the ruled notice and the re-read schedule, for a host
 * that must not load the entry — the cross-repo door.
 *
 * WHY A ROOT MODULE AND NOT THE ENTRY. The Dashboard's case page reads
 * `deleting` from `GET /cases/{case_id}` too, and shows the same sentence on
 * the same schedule as the panel (faultmaven#2341). It may not import this
 * package's entry, which pulls the panel, the host store and the transport into
 * its eager graph (ADR-016 D3), nor a `lib/` path, which its import rule
 * refuses. So these names travel through a root module, as `turn-label.ts`'s
 * do. Its one import is `lib/cases/deleting.ts`, which has none of its own.
 *
 * The reasoning for the schedule lives with the code in `lib/cases/deleting.ts`.
 * This file is the door, not a second copy of it.
 */

export {
  CASE_DELETING_NOTICE,
  nextDeletingReread,
  DELETING_REREAD_FIRST_MS,
  DELETING_REREAD_MAX_MS,
  DELETING_REREAD_CAP_MS,
} from './lib/cases/deleting';
