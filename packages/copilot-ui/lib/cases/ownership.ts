/**
 * Whose case is it — and so may this viewer write to it.
 *
 * A team share grants READ visibility, not the right to drive (fm#1898, ruling
 * 2026-10-09, ADR-013 D4 amendment): the turn service refuses anyone but the
 * case's owner, and resume / title / update are owner-only as well. The list
 * and the case endpoints still return a teammate's case, so the client has to
 * render it as the record it is.
 *
 * Ids are compared, never names or emails: two people can share a display name,
 * and an email is not what `cases.user_id` holds.
 *
 * Unknown is writable. A placeholder row (`handleCaseSelect` before its
 * hydration lands) and a locally created case carry no `owner_id`; calling
 * those read-only would hide the composer from a user opening their own case,
 * and the server's 403 is the backstop for the window. Only a row that NAMES an
 * owner other than the viewer is someone else's.
 */
export function isOwnedByOther(
  owner: { owner_id?: string | null } | null | undefined,
  viewerId: string | null | undefined,
): boolean {
  const ownerId = owner?.owner_id;
  if (!ownerId || !viewerId) return false;
  return ownerId !== viewerId;
}

/** The line shown where the composer would be. One copy, so the 403 path says the same thing. */
export const SHARED_READ_ONLY_NOTICE =
  'Shared with you — read-only. Only the person who opened this case can add to it.';
