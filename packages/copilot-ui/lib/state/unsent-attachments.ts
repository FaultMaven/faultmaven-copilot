/**
 * What a failed turn says about the attachments it carried.
 *
 * The server commits an uploaded file only with the turn that carried it, so a
 * turn that failed with an HTTP error status left nothing on the case. The user
 * must be told which files did not land, and that Retry sends them again. Every
 * surface that renders the failure (the failed-operation banner, the failed
 * assistant bubble) takes its wording from here so they cannot disagree.
 *
 * The client does not always KNOW the file did not land. A network drop after
 * the request was sent, a client-side timeout, or an async-poll timeout all end
 * without an HTTP response, and the turn may have committed regardless. So do a
 * 502 and a 504: a gateway answers them while the API may still be running the
 * turn. Those failures say "may not have been added"; any other received HTTP
 * error status says "were not added".
 */
import { ErrorClassifier } from '../errors/classifier';
import { NetworkError, TimeoutError } from '../errors/types';

/** Statuses a gateway answers on the API's behalf; the turn may still commit. */
const GATEWAY_STATUSES = new Set([502, 504]);

/** Names listed before the rest are summarised as "and N more". */
const MAX_NAMES_LISTED = 3;

/** One attachment of a turn, as the failure copy names it. */
export interface UnsentAttachment {
  /** The file's own name, or the label of generated content ("the pasted text"). */
  name: string;
  /** A file the user chose, as opposed to pasted text or a page capture. */
  isFile: boolean;
}

/**
 * What a turn's failure state needs to word itself. One object per turn, shared
 * by reference between the pending operation (the banner) and the failure
 * handler (the bubble), so both read the same facts.
 */
export interface UnsentTurn {
  attachments: UnsentAttachment[];
  /** The user typed text of their own (not the auto-generated question). */
  hasQuery: boolean;
  /** The failure carried no HTTP response, so the turn may have committed. */
  ambiguous?: boolean;
}

/**
 * Whether a failure leaves it unknown if the turn committed. Classified once,
 * here. A gateway status (502, 504) is ambiguous: the proxy gave up on the API,
 * which may still commit the turn. Any other received HTTP error status is
 * definite. Without a status, a network or timeout error is ambiguous, and
 * anything else (a client-side rejection before sending) is definite.
 */
export function isAmbiguousFailure(error: unknown): boolean {
  const classified = ErrorClassifier.classify(error);
  // The retry layer hands over an already classified error; the HTTP status
  // lives on the error it wraps.
  const cause = classified.originalError ?? classified;
  const status = (cause as { status?: unknown }).status;
  if (typeof status === 'number') return GATEWAY_STATUSES.has(status);
  return classified instanceof NetworkError || classified instanceof TimeoutError;
}

/**
 * The sentence that tells the user what a failed turn did not add to the case,
 * or `null` for a turn that carried no attachments (the caller keeps its
 * message-only copy).
 */
export function unsentAttachmentsNotice(turn: UnsentTurn | undefined): string | null {
  const attachments = turn?.attachments;
  if (!turn || !attachments || attachments.length === 0) return null;
  const { hasQuery, ambiguous } = turn;

  const allFiles = attachments.every((a) => a.isFile);
  const noun = allFiles ? (attachments.length === 1 ? 'file' : 'files') : (attachments.length === 1 ? 'attachment' : 'attachments');
  const listed = attachments.slice(0, MAX_NAMES_LISTED).map((a) => a.name);
  const rest = attachments.length - listed.length;
  const names = rest > 0 ? `${listed.join(', ')} and ${rest} more` : listed.join(', ');
  const subject = attachments.length === 1 && !allFiles
    ? names
    : `${attachments.length} ${noun} (${names})`;
  const lead = hasQuery ? `Your message and ${subject}` : subject.charAt(0).toUpperCase() + subject.slice(1);
  const verb = hasQuery || attachments.length > 1 ? 'were' : 'was';
  const them = attachments.length === 1 && !hasQuery ? 'it' : 'them';
  const outcome = ambiguous ? 'may not have been added' : `${verb} not added`;
  return `${lead} ${outcome} to the case. Retry sends ${them} again.`;
}
