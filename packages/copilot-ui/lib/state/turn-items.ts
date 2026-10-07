import type { SuggestedAction, SuggestionIntent, SuggestionType, TurnResponse } from '../api';
import type { DuplicateUpload } from '../errors/types';
import type { OptimisticConversationItem } from '../optimistic';
import { isCommittedMessage } from '../utils/memory-manager';
import { investigationTurnFor, serverSuppliesInvestigationTurn } from './turn-label';
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

/**
 * The attachments of `response` that re-upload a file from an EARLIER turn of
 * the case: the server matched them by content (`duplicate_of`) and stored
 * nothing new.
 *
 * `rows` is the conversation as submitted, BEFORE `applyTurnResponse`, and
 * `userRowId` is this submission's user row, which still carries its predicted
 * turn number there.
 *
 * Not every match is a re-upload. The server commits an attachment's file as
 * soon as it is processed, before the turn can fail, so that a retry dedups
 * against it instead of storing a second copy, and only a successful response
 * is replayed. A retried upload is therefore matched to ITS OWN failed first
 * attempt, and a second copy of the same content in one submission to the
 * first. Both originals sit on a turn after every turn this client holds as
 * committed, and at or after this submission's predicted turn. A genuine
 * re-upload's original sits at or before the former and before the latter. So
 * a match counts only when both hold:
 *
 * - at or before the newest COMMITTED row before this submission. Failed rows
 *   are excluded: their turn numbers are predictions, not turns the server used.
 * - before this submission's predicted turn, which was fixed when it was first
 *   sent. That excludes rows a later fetch merged in after the failed attempt.
 *
 * With no committed row before this submission, or no `duplicate_turn`, nothing
 * shows the original came earlier, and the match is not reported. A missing
 * notice costs nothing; a false one tells the user they repeated themselves.
 *
 * `duplicate_turn` is the MESSAGE clock (the original's `uploaded_at_turn`), so
 * each is given the turn the conversation PRINTS for it. When no loaded row
 * labels it, the turn is left out rather than printed as the other counter
 * (see `investigationTurnFor`).
 */
export function duplicateUploads(
  response: TurnResponse,
  rows: readonly OptimisticConversationItem[] | undefined,
  userRowId: string
): DuplicateUpload[] {
  if (!rows) return [];
  const submittedAt = rows.find((row) => row.id === userRowId)?.turn_number;
  let lastCommittedTurn: number | undefined;
  for (const row of rowsBefore(rows, userRowId)) {
    if (isCommittedMessage(row) && typeof row.turn_number === 'number') {
      lastCommittedTurn = Math.max(lastCommittedTurn ?? row.turn_number, row.turn_number);
    }
  }
  if (submittedAt === undefined || lastCommittedTurn === undefined) return [];

  const duplicates: DuplicateUpload[] = [];
  for (const attachment of response.attachments_processed ?? []) {
    const original = attachment.duplicate_turn;
    if (!attachment.duplicate_of || typeof original !== 'number') continue;
    if (original > lastCommittedTurn || original >= submittedAt) continue;
    const turn = investigationTurnFor(original, rows);
    duplicates.push(turn === undefined ? { filename: attachment.filename } : { filename: attachment.filename, turn });
  }
  return duplicates;
}
