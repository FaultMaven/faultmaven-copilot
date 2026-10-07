import type { SuggestedAction, SuggestionIntent, SuggestionType, TurnResponse } from '../api';
import type { OptimisticConversationItem } from '../optimistic';
import { serverSuppliesInvestigationTurn } from './turn-label';
import { rowsBefore, sourcesToShow } from './turn-sources';

type SuggestedActionResponse = NonNullable<TurnResponse['suggested_actions']>[number];

/** The two optimistic rows a turn submission minted, by id. */
export interface TurnRowIds {
  user: string;
  assistant: string;
}

export interface ApplyTurnOptions {
  /** The assistant text when the turn answers with none (an upload-only turn can). */
  emptyResponseText?: string;
}

/**
 * Commit a successful turn: the conversation `rows` with the two optimistic
 * rows `ids` names replaced by what `response` says. Every other row is
 * returned as it is.
 *
 * The ONE mapping from `TurnResponse` to stored rows, for both turn paths
 * (`useMessageSubmission`, `useDataUpload`). Each used to write its own, behind
 * an `as OptimisticConversationItem` cast, so a field had to be added to both
 * by hand: `sources` was missing from both until #298, which is why no KB
 * citation ever rendered. Here the rows are typed, not cast, so the compiler
 * checks every field against the item and the generated `TurnResponse`.
 */
export function applyTurnResponse(
  rows: readonly OptimisticConversationItem[],
  ids: TurnRowIds,
  response: TurnResponse,
  options: ApplyTurnOptions = {}
): OptimisticConversationItem[] {
  // `TurnResponse.investigation_turn` shipped in contract 2.7.0 and the per-row
  // `Message.investigation_turn` only in 3.5.0, so against a server in between
  // one channel answers and the other does not. Taking the label from both
  // numbers ONE conversation two ways: the history falls back to the clock while
  // this turn's rows take the investigation count, so they can repeat the
  // number above them and then change when the panel is reopened. If no row
  // here carries the field, the server does not send it — leave these rows on
  // the clock with their neighbours.
  //
  // Otherwise the response reports the case's investigation turn AS OF this
  // turn, so it is the label for these two rows and only these, and the value
  // they are given when re-read from `/messages` later: it does not move on
  // reload (#251).
  const investigationTurn = serverSuppliesInvestigationTurn(rows)
    ? response.investigation_turn ?? null
    : null;
  const processed = response.attachments_processed ?? [];

  return rows.map((item): OptimisticConversationItem => {
    if (item.id === ids.user) {
      return {
        ...item,
        // The server's account of the attachments when it gives one. A turn it
        // reports without them (the field is optional) keeps what the row
        // already shows, rather than dropping the chips.
        attachments: processed.length > 0 ? processed : item.attachments,
        // The local turn_number was a PREDICTION (`highestTurn + 1`). A user
        // message and its reply share a turn_number by backend design, so both
        // rows take the backend's. Without this the user row keeps a number that
        // is merely usually right, and the id reconciliation in the delta merge
        // (#213), which matches on turn AND slot, misses it whenever the
        // prediction was off and puts back the duplicate it exists to prevent.
        turn_number: response.turn_number,
        investigation_turn: investigationTurn,
        optimistic: false,
        originalId: ids.user,
      };
    }
    if (item.id === ids.assistant) {
      return {
        ...item,
        response: response.agent_response || options.emptyResponseText || '',
        turn_number: response.turn_number,
        investigation_turn: investigationTurn,
        suggestedActions: response.suggested_actions?.map(suggestionFromResponse) ?? null,
        sources: sourcesToShow(response.sources, rowsBefore(rows, ids.assistant)),
        optimistic: false,
        loading: false,
        // A successful (re)submission clears any error state a prior failed
        // attempt left (#101): otherwise the row renders in error styling and
        // isCommittedMessage drops it from persistence.
        error: false,
        failed: false,
        errorMessage: undefined,
        originalId: ids.assistant,
      };
    }
    return item;
  });
}

/**
 * One suggestion as the panel holds it, narrowed from the contract's
 * `SuggestedActionResponse`.
 *
 * - `type` is a bare string on the wire. A value this build does not know
 *   becomes UNRECOGNIZED, which renders as plain text and is never clickable
 *   (see `SuggestionType`).
 * - `intent` is kept whole, extra keys and all; see `SuggestionIntent`.
 * - The contract's `null`s become absent fields.
 */
export function suggestionFromResponse(response: SuggestedActionResponse): SuggestedAction {
  return {
    label: response.label,
    type: knownSuggestionType(response.type),
    payload: response.payload ?? undefined,
    body: response.body ?? undefined,
    hints: response.hints ?? undefined,
    intent: forwardableIntent(response.intent),
    evidence_need_id: response.evidence_need_id ?? undefined,
  };
}

function knownSuggestionType(type: string): SuggestionType {
  switch (type) {
    case 'DECIDE':
    case 'RUN':
    case 'EVIDENCE':
    case 'FREE_SPEECH':
      return type;
    default:
      return 'UNRECOGNIZED';
  }
}

function forwardableIntent(intent: SuggestedActionResponse['intent']): SuggestionIntent | undefined {
  if (!intent) return undefined;
  const { type } = intent;
  // An empty type is no type: the request would carry no `intent_type`.
  return typeof type === 'string' && type !== '' ? { ...intent, type } : undefined;
}
