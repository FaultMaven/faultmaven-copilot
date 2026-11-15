import type { Source } from '../api';
import type { ConversationItem } from '../optimistic';

/**
 * Which `sources` to store on an assistant row.
 *
 * `TurnResponse.sources` (and `Message.sources`, its persisted copy) is the KB
 * context that turn's prompt actually carried, as runbook sections (up to two
 * per runbook). Most of it is the pre-fetched context (`metadata.trigger`
 * `symptom` / `root_cause`), which stands in every prompt until a pre-fetch
 * replaces it, so it repeats turn to turn (API contract 11.2.0). A turn can
 * add what its own searches found: the lookup for a question about the
 * knowledge base (`question`, 14.24.0) and the sections the assistant's own
 * search answered from (`kb_qa`). The server marks `new_this_turn` on the
 * pre-fetched excerpts the previous pre-fetched context did not carry and on
 * every entry a search found for this turn, so a row keeps the list only where
 * something in it is new: the list shows where the context arrives or changes,
 * or where a search answered, not under every answer, and is not persisted
 * once per row. The card groups the list by channel (`InlineSourcesRenderer`).
 *
 * A self-hosted core older than 11.2.0 sends `sources` with no flag at all.
 * For that server the row keeps the list where it differs from the last list
 * an earlier row kept (`earlier`, the rows before this one) — the rule this
 * client used before the server said what was new. An empty list keeps
 * nothing on either server: a turn whose prompt carried no KB context answers
 * `[]` while the context still stands.
 *
 * The live turn paths (both through `applyTurnResponse`, `lib/state/turn-items`)
 * and the history mapper (`cases-slice`) all call this, so a conversation read
 * back from the server shows the list exactly where the live turn did.
 */
export function sourcesToShow(
  sources: Source[] | null | undefined,
  earlier: readonly ConversationItem[] = []
): Source[] | undefined {
  if (!sources || sources.length === 0) return undefined;
  if (sources.some((source) => typeof source.new_this_turn === 'boolean')) {
    return sources.some((source) => source.new_this_turn === true) ? sources : undefined;
  }
  let recorded: readonly Source[] = [];
  for (let i = earlier.length - 1; i >= 0; i--) {
    const kept = earlier[i].sources;
    if (kept && kept.length > 0) {
      recorded = kept;
      break;
    }
  }
  return sameSources(recorded, sources) ? undefined : sources;
}

/**
 * A knowledge-base source the viewer may not open, redacted by the server
 * (contract 13.1.0, fm#1920). A case retrieves with its DRIVER's knowledge
 * (ADR-020 D9), so a reader can find a runbook in a turn's context that they
 * cannot open themselves: the server keeps the entry, so the count of what
 * the model had stays true, and strips it to `content` "", `confidence` null
 * and `metadata` `{"access": "restricted"}` — no title, no document id.
 *
 * It names no runbook, so it is never a link, a "Source N" or a preview; it
 * renders as "A runbook you don't have access to".
 */
export function isRestrictedSource(source: Source): boolean {
  return source.type === 'knowledge_base' && source.metadata?.access === 'restricted';
}

/** Shown in place of a runbook the viewer may not open. */
export const RESTRICTED_SOURCE_LABEL = "A runbook you don't have access to";

/** The rows before `itemId` — the ones a turn's row is compared against. */
export function rowsBefore<T extends { id: string }>(rows: readonly T[], itemId: string): readonly T[] {
  const at = rows.findIndex((row) => row.id === itemId);
  return at === -1 ? rows : rows.slice(0, at);
}

function sourceKey(source: Source): string {
  return `${source.type}|${String(source.metadata?.document_id ?? '')}|${source.content}`;
}

function sameSources(a: readonly Source[], b: readonly Source[]): boolean {
  return a.length === b.length && a.every((source, i) => sourceKey(source) === sourceKey(b[i]));
}
