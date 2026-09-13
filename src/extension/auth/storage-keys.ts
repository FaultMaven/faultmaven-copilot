/**
 * Storage key names shared between the credential stack (`auth/`) and the host
 * adapters (`host/`).
 *
 * Deliberately dependency-free — no `wxt/browser`, no logger — so a content
 * script, the background worker and the panel can all import it without
 * dragging anything else in.
 */

/**
 * The composite auth row.
 *
 * Its disappearance IS the sign-out: `subscribeExtensionAuthState` watches this
 * key and nothing else, so a teardown that leaves it behind ends the session
 * unobservably and the panel goes on rendering a signed-in UI it can no longer
 * authenticate. That makes the spelling an invariant across every teardown
 * path, which is why it lives here instead of being typed out at each one.
 * See CLAUDE.md, "Auth teardown".
 */
export const AUTH_STATE_KEY = 'authState';

/**
 * Every key that makes up a stored credential.
 *
 * One list, read by `getStoredTokens` and removed by `clearTokens`, for the same
 * reason `AUTH_STATE_KEY` exists: a key added to the writers and forgotten in
 * the teardown stays at rest after a "full" logout — the same partial-teardown
 * failure as the `authState` omission, and just as invisible to every test.
 */
export const CREDENTIAL_KEYS = [
  'access_token',
  'token_type',
  'expires_at',
  'refresh_token',
  'refresh_expires_at',
  'session_id',
  'user',
] as const;

/**
 * A key that is part of the stored credential.
 *
 * Writers type their payload as `Partial<Record<CredentialKey, …>>` so a field
 * added there but not to `CREDENTIAL_KEYS` is a compile error rather than a key
 * that survives a "full" logout at rest — the drift this list exists to stop,
 * and one that no test would notice.
 */
export type CredentialKey = (typeof CREDENTIAL_KEYS)[number];

/**
 * Is this a timestamp anything can reason about?
 *
 * `undefined` (never written), `null` (Chrome flattening NaN) and `NaN` (Firefox
 * keeps it) all mean NO. Shared with the credential WRITERS, not just the
 * readers: `local-auth-client` and `handleStoreAuth` each decide whether a
 * response carried a usable expiry, and three hand-rolled copies of one rule is
 * how the readers came to disagree in the first place.
 *
 * Writers that find `false` must REMOVE the key rather than store a sentinel —
 * one encoding of "unknown", so nothing downstream has to know two.
 */
export function isUsableTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Is this a DURATION we can turn into a timestamp?
 *
 * Separate from `isUsableTimestamp` because the fields differ in kind and in
 * what counts as valid: `expires_in` is seconds-from-now, and zero or negative
 * is not merely odd but produces an `expires_at` already in the past at the
 * instant of sign-in. Validating a duration with the timestamp predicate let
 * `expires_in: 0` through.
 */
export function isUsableDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * `isUsableTimestamp` as a narrowing read: the timestamp, or `null`.
 *
 * Lives beside the predicate rather than being re-spelled in the reader, so
 * there is one rule with one home — a second *name* for it in `token-manager`
 * was the fourth copy in a module whose whole argument is that hand-rolled
 * copies are how the readers came to disagree.
 */
export function timestampOrNull(value: unknown): number | null {
  return isUsableTimestamp(value) ? value : null;
}
