// Account identity presentation — initials and a stable colour.
//
// The Dashboard and the Copilot authenticate separately, on independent token
// chains, so the same browser can hold two different signed-in accounts. The
// colour here exists to make that visible: it is derived from `user_id`, so the
// same person renders the same colour in both clients and a mismatch is
// noticeable without reading anything.
//
// Both clients must keep this derivation identical or the comparison silently
// stops working — a mismatch would then mean nothing, which is worse than not
// showing a colour at all.

/** Palette entries hold contrast against the fm-surface / fm-base greys.
 *  Order is part of the contract: the index is derived, so reordering these
 *  repaints every existing account. Append only. */
export const IDENTITY_COLORS = [
  '#818CF8', // indigo
  '#2DD4BF', // teal
  '#FBBF24', // amber
  '#FB7185', // rose
  '#A78BFA', // violet
  '#38BDF8', // sky
  '#34D399', // emerald
  '#F472B6', // pink
] as const;

/**
 * Stable colour for an account.
 *
 * Keyed on `user_id` and never on the name: two people who share initials must
 * not share a colour, and renaming someone must not repaint them.
 *
 * FNV-1a — chosen because it is short enough to be obviously identical in both
 * codebases, which matters more here than distribution quality.
 */
export function identityColor(userId: string | undefined | null): string {
  if (!userId) return IDENTITY_COLORS[0];

  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return IDENTITY_COLORS[Math.abs(hash) % IDENTITY_COLORS.length];
}

/**
 * Up to two initials for the monogram.
 *
 * Prefers the display name, falls back to the username, then the email's local
 * part — the account always has at least one of these, so the monogram never
 * renders empty. Non-letter characters are skipped so `sterlan.yu` and
 * `sterlan_yu` both give "SY" rather than "S." or "S_".
 */
export function accountInitials(
  displayName?: string | null,
  username?: string | null,
  email?: string | null,
): string {
  const source =
    displayName?.trim() ||
    username?.trim() ||
    email?.split('@')[0]?.trim() ||
    '';

  const words = source
    .split(/[\s._-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);

  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** The elevated role worth surfacing, or null. `platform_admin` is the
 *  cross-tenant operator role; `admin` is organization-scoped (ADR-012 D9)
 *  and deliberately not badged — it is ordinary within its own org. */
export function elevatedRole(roles?: string[] | null): string | null {
  return roles?.includes('platform_admin') ? 'Platform admin' : null;
}
