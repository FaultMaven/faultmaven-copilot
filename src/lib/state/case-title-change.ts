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
  onPersistError: (error: unknown) => void;
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
    deps.onPersistError(error);

    // Restore both maps to their exact pre-optimistic values.
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
  }
}
