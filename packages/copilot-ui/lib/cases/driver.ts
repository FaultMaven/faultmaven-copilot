/**
 * Who drives a case — and so may this viewer write to it.
 *
 * A case has a CREATOR (`user_id`, the client's `owner_id`) and one DRIVER
 * (ADR-020, fm#1898). Every reader views a case; the driver alone holds the
 * investigation writes (turns, uploads, title, close, reports, resume); the
 * creator holds governance (delete, share, unshare). On the wire `driver_id` is
 * always the EFFECTIVE driver, so a client never re-implements "NULL means the
 * creator drives".
 *
 * The extension lists only the cases its user drives (`GET /cases?access=write`),
 * but a case can be reassigned away while it is open, and a restored last case
 * is opened without a list row, so the open case is still judged here.
 *
 * Ids are compared, never names or emails: two people can share a display name,
 * and an email is not what `cases.driver_id` holds.
 *
 * Unknown is writable. A placeholder row (`handleCaseSelect` before its
 * hydration lands) and a locally created case carry no `driver_id`; calling
 * those read-only would hide the composer from a user opening their own case,
 * and the server's 403 is the backstop for that window. Only a row that NAMES
 * a driver other than the viewer is read-only.
 */
export function isDrivenByOther(
  row: { driver_id?: string | null } | null | undefined,
  viewerId: string | null | undefined,
): boolean {
  const driverId = row?.driver_id;
  if (!driverId || !viewerId) return false;
  return driverId !== viewerId;
}

/**
 * The viewer created this case, so holds its governance (delete). Unlike the
 * driver rule, unknown is NOT the creator: offering a delete the server will
 * refuse is a dead control, and there is no window to bridge.
 */
export function isCreatedBy(
  row: { owner_id?: string | null } | null | undefined,
  viewerId: string | null | undefined,
): boolean {
  const creatorId = row?.owner_id;
  return Boolean(creatorId && viewerId && creatorId === viewerId);
}

/** The line shown where the composer would be. One copy, so the 403 path says the same thing. */
export const DRIVER_READ_ONLY_NOTICE = "Only the case's driver can add to it.";

/** Shown in the bubble while the read-back decides who drives the case; claims nothing yet. */
export const CHECKING_ACCESS_NOTICE = 'Checking whether you can add to this case…';
