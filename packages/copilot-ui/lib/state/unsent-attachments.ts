/**
 * What a failed turn says about the attachments it carried.
 *
 * The server commits an uploaded file only with the turn that carried it, so a
 * failed turn leaves nothing on the case. The user must be told which files did
 * not land, and that Retry sends them again. Every surface that renders the
 * failure (the failed-operation banner, the failed assistant bubble) takes its
 * wording from here so they cannot disagree.
 */

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
 * The sentence that tells the user what a failed turn did not add to the case,
 * or `null` for a turn that carried no attachments (the caller keeps its
 * message-only copy).
 */
export function unsentAttachmentsNotice(
  attachments: readonly UnsentAttachment[] | undefined,
  { hasQuery }: { hasQuery: boolean }
): string | null {
  if (!attachments || attachments.length === 0) return null;

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
  return `${lead} ${verb} not added to the case. Retry sends ${them} again.`;
}
