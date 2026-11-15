/**
 * Applying a case-title change — resolved in ONE place.
 *
 * A title can arrive from two places with genuinely different obligations, and
 * conflating them is what produced fm#1069's second failure:
 *
 *   - `'user'`    — the user typed it. Nothing has persisted it, so this owes a
 *                   `PUT /cases/{id}`, and owes a rollback if that write fails.
 *   - `'backend'` — `POST /cases/{id}/title` generated AND persisted it before
 *                   answering. The row already holds this value. A `PUT` here is
 *                   a second write of something the server already has, and on a
 *                   terminal case `require_case_not_terminal` answers **409** —
 *                   at which point the rollback below would undo a title that had
 *                   in fact been saved, and raise an error toast for a success.
 *
 * The store write is identical for both; only the persistence leg differs. This
 * lives outside the component so the distinction is testable — inside a JSX prop
 * it was reachable only by rendering the whole side panel, which is why the
 * redundant write went unnoticed.
 */

import { ErrorClassifier } from '../errors/classifier';
import { CaseNotFoundError, CaseTerminalError } from '../errors/types';
import { DRIVER_READ_ONLY_NOTICE } from '../cases/driver';
import { isCaseWriteRefusal, type RefusedWriteReading } from './write-refused';

export type TitleSource = 'user' | 'backend' | 'system';

type TitleMap = Record<string, string>;
type SourceMap = Record<string, TitleSource>;
type Updater<T> = (updater: (prev: T) => T) => void;

export interface CaseTitleChangeDeps {
  /** Read the store synchronously, for the pre-write snapshot used on rollback. */
  readStore: () => { conversationTitles: TitleMap; titleSources: SourceMap };
  setConversationTitles: Updater<TitleMap>;
  setTitleSources: Updater<SourceMap>;
  /** `PUT /cases/{id}` — called only when the client is the origin of the change. */
  persistTitle: (caseId: string, title: string) => Promise<void>;
  /**
   * The write failed. Handed the `CaseTerminalError` itself on a 409
   * `CASE_TERMINAL`, and a `CaseNotFoundError` for a case its read-back found
   * gone, so each can be shown as what it is; otherwise an `Error` whose
   * message says why (the driver notice for a case another account drives, the
   * server's text for anything else).
   */
  onPersistError: (error: unknown) => void;
  /**
   * Read the case row back (`refreshActiveCase`). Called on a 409
   * `CASE_TERMINAL`: the case is resolved or closed, and the panel should show
   * it so. A retry of the rename can only meet the same refusal.
   */
  refreshCase: (caseId: string) => void;
  /**
   * Read the case back after a 403 or 404 (`readBackRefusedWrite`): only the
   * row can tell a case that is gone from one another account drives, and it
   * acts on whichever it is (the case closes, or leaves the sidebar).
   */
  readBackRefusal: (caseId: string) => Promise<RefusedWriteReading>;
  log?: { info: (msg: string, data?: unknown) => void; error: (msg: string, data?: unknown) => void };
}

export async function applyCaseTitleChange(
  caseId: string,
  newTitle: string,
  source: 'user' | 'backend',
  deps: CaseTitleChangeDeps
): Promise<void> {
  // Capture prior title + provenance so a failed backend PUT rolls BOTH back
  // together. Leaving titleSources set after a failed rename would misreport who
  // chose the title the user is still looking at.
  const { conversationTitles: prevTitles, titleSources: prevSources } = deps.readStore();
  const priorTitle = prevTitles[caseId];
  const priorSource = prevSources[caseId];

  deps.setConversationTitles(prev => ({ ...prev, [caseId]: newTitle }));
  deps.setTitleSources(prev => ({ ...prev, [caseId]: source }));

  // Already persisted by the generator — nothing to send, so nothing to fail,
  // so nothing to roll back.
  if (source === 'backend') return;

  try {
    await deps.persistTitle(caseId, newTitle);
    deps.log?.info('Case title updated successfully', { caseId, newTitle });
  } catch (error) {
    deps.log?.error('Failed to update case title', { caseId, newTitle, error });
    const classified = ErrorClassifier.classify(error);

    // Restore both maps to their exact pre-optimistic values, before any
    // read-back below: the title the user sees is the one the server holds.
    deps.setConversationTitles(prev => {
      const next = { ...prev };
      if (priorTitle === undefined) delete next[caseId];
      else next[caseId] = priorTitle;
      return next;
    });
    deps.setTitleSources(prev => {
      const next = { ...prev };
      if (priorSource === undefined) delete next[caseId];
      else next[caseId] = priorSource;
      return next;
    });

    if (classified instanceof CaseTerminalError) {
      deps.onPersistError(classified);
      deps.refreshCase(caseId);
    } else if (isCaseWriteRefusal(error, classified)) {
      // Gone, or handed to another driver (#384, faultmaven#2806): the row says
      // which, and the toast says what it found.
      const reading = await deps.readBackRefusal(caseId);
      if (reading === 'gone') deps.onPersistError(new CaseNotFoundError(CaseNotFoundError.USER_MESSAGE, error instanceof Error ? error : undefined));
      else if (reading === 'driven_by_other') deps.onPersistError(new Error(DRIVER_READ_ONLY_NOTICE));
      else deps.onPersistError(error);
    } else {
      deps.onPersistError(error);
    }
  }
}
