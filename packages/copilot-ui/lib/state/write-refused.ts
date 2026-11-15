/**
 * The server refused a write to a case: this viewer may not write it (403), or
 * a 404 did not say what was missing (an older core's case 404, or the turn
 * route's 404 for evidence or a file inside the case).
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
 * disagree about what a refusal means; `readBackRefusedWrite` is the verdict
 * itself, which the rename and title generation share too.
 */
import type { OptimisticConversationItem } from '../optimistic';
import { CHECKING_ACCESS_NOTICE, DRIVER_READ_ONLY_NOTICE, isDrivenByOther } from '../cases/driver';
import {
  CaseNotFoundError,
  isUnlabelledNotFound,
  PermissionError,
  UserFacingError,
} from '../errors/types';
import { reloadDrivenCaseList } from './case-list-reload';
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
    const reading = await readBackRefusedWrite(caseId, epoch);
    if (epoch !== getEpoch()) return;
    if (reading === 'gone') setBubble(CaseNotFoundError.BUBBLE_TEXT);
    else if (reading === 'driven_by_other') setBubble(DRIVER_READ_ONLY_NOTICE);
    else setBubble(fallbackText);
  })();
}

/**
 * Whether a failed case write is one the case row can explain: a 403 (another
 * account drives the case: `CASE_NOT_DRIVER`, faultmaven#2806), a labelled
 * `CASE_NOT_FOUND` 404, or an unlabelled 404. A core before #2806 answers a
 * driver-only write (rename, title generation) by a reader who does not drive
 * the case with the same unlabelled 404 an absent case gets, so only the row
 * can tell "gone" from "handed off".
 */
export function isCaseWriteRefusal(error: unknown, classified: UserFacingError): boolean {
  return (
    classified instanceof CaseNotFoundError ||
    classified instanceof PermissionError ||
    isUnlabelledNotFound(error)
  );
}

/**
 * What a refused turn's bubble says when the case row explains nothing: a 403's
 * own copy, or, for a 404 that named nothing, the server's text (the classifier
 * words every 404 alike, "Resource not found").
 */
export function refusalText(error: unknown, classified: UserFacingError): string {
  if (classified instanceof PermissionError) return classified.userMessage;
  const raw = error instanceof UserFacingError ? error.originalError : error;
  return raw instanceof Error && raw.message ? raw.message : classified.userMessage;
}

/** What reading a refused case back said about the refusal. */
export type RefusedWriteReading = 'gone' | 'driven_by_other' | 'unexplained';

/**
 * Reads a refused case back and acts on what the row says, whichever case is
 * open: `gone` (a 404 — `readCaseBack` has closed it if it was open and
 * dropped its row from the list); `driven_by_other` (marked denied, so the
 * panel renders it read-only, and taken out of the sidebar, which lists the
 * cases this user drives — here as well as in the extension host, because the
 * user may have opened another case before the read landed); otherwise
 * `unexplained` (the row names the viewer as driver, or the read failed): the
 * refusal is something else, and the caller says what the server said.
 */
export async function readBackRefusedWrite(caseId: string, epoch: number): Promise<RefusedWriteReading> {
  const read = await useAppStore.getState().readCaseBack(caseId);
  if (epoch !== getEpoch()) return 'unexplained';
  if (read.kind === 'gone') return 'gone';
  const state = useAppStore.getState();
  if (read.kind === 'row' && isDrivenByOther(read.row, state.currentUser?.id)) {
    state.markWriteDenied(caseId);
    await reloadDrivenCaseList(epoch);
    return 'driven_by_other';
  }
  return 'unexplained';
}
