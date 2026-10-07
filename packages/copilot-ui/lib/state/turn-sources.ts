import type { Source } from '../api';
import type { ConversationItem } from '../optimistic';

/**
 * Which `sources` to store on the assistant row a turn produces.
 *
 * `TurnResponse.sources` is the case's current KB context: the runbooks the
 * pre-fetch put in front of the model (at most five, replaced when a pre-fetch
 * fires). The backend resends it on EVERY turn while it stands, because it is
 * in every turn's prompt. Storing it on every row would repeat one list under
 * each reply and persist a copy per row, so a row carries it only where it
 * differs from the most recent list an earlier row recorded.
 *
 * An empty `sources` records nothing. A turn whose prompt carried no KB
 * context (a greeting, an aside) answers with `[]` while the context still
 * stands, so `[]` cannot mean "the context is gone" (contract 11.2.0, where the
 * server reports per turn what its prompt carried). Reading it that way showed
 * the standing list again on the turn after every aside. Rows written by the
 * earlier rule may hold `[]`; the search skips them.
 *
 * Both turn paths (`useMessageSubmission`, `useDataUpload`) call this, so the
 * rule is written once.
 */
export function sourcesForTurn(
  conversation: readonly ConversationItem[],
  assistantItemId: string,
  incoming: Source[] | undefined
): Source[] | undefined {
  const at = conversation.findIndex((item) => item.id === assistantItemId);
  const earlier = at === -1 ? conversation : conversation.slice(0, at);
  if (!incoming || incoming.length === 0) return undefined;
  let recorded: Source[] = [];
  for (let i = earlier.length - 1; i >= 0; i--) {
    const sources = earlier[i].sources;
    if (sources && sources.length > 0) {
      recorded = sources;
      break;
    }
  }
  return sameSources(recorded, incoming) ? undefined : incoming;
}

function sourceKey(source: Source): string {
  return `${source.type}|${String(source.metadata?.document_id ?? '')}|${source.content}`;
}

function sameSources(a: readonly Source[], b: readonly Source[]): boolean {
  return a.length === b.length && a.every((source, i) => sourceKey(source) === sourceKey(b[i]));
}
