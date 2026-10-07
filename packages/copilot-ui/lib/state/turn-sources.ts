import type { Source } from '../api';

/**
 * Which `sources` to store on an assistant row.
 *
 * `TurnResponse.sources` (and `Message.sources`, its persisted copy) is the KB
 * context that turn's prompt actually carried: at most five runbooks, standing
 * in every prompt until a pre-fetch replaces it, so it repeats turn to turn
 * (API contract 11.2.0). The server marks the excerpts the previous turn's
 * prompt did not carry `new_this_turn`, so a row keeps the list only where
 * something in it is new: the list shows where the context arrives or changes,
 * not under every answer, and is not persisted once per row.
 *
 * The live turn paths (`useMessageSubmission`, `useDataUpload`) and the history
 * mapper (`cases-slice`) all call this, so a conversation read back from the
 * server shows the list exactly where the live turn did.
 */
export function sourcesToShow(sources: Source[] | null | undefined): Source[] | undefined {
  return sources?.some((source) => source.new_this_turn === true) ? sources : undefined;
}
