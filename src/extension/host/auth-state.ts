/**
 * "Who is signed in changed elsewhere", as the extension observes it.
 *
 * Two mechanisms, one fact. A sign-in or sign-out completed in another context
 * BROADCASTS on `runtime.onMessage`; a credential can also simply be CLEARED,
 * with the storage key disappearing and no broadcast to go with it (a hard 401
 * torn down in the background is the case that matters). The shared UI used to
 * subscribe to both and hold the key name to do it — which is how a tree that
 * owns no credential came to name `authState`.
 *
 * Both are the extension's own transports, so both are answered here and what
 * crosses the boundary is a `HostUser` or `null`.
 */
import { EventBus, isSignedInBroadcast, type AuthStateChangedEvent } from '../messaging';
import { extensionStore } from './extension-store';
import { AUTH_STATE_KEY, DATA_OWNER_KEY } from '../auth/storage-keys';
import type { HostUser } from '@faultmaven/copilot-ui/shared/host';

// `AUTH_STATE_KEY` is imported rather than spelled here: the same string is an
// invariant on every teardown path (auth/storage-keys.ts), and this module is
// the reader that makes it one. Watching the credential keys instead would be
// the wrong repair — it reports a sign-out the UI believes while
// `authManager.isAuthenticated()` still answers true from the row left in
// storage. Keep the teardown honest rather than widening the watch.

/** The broadcast's user payload, whatever shape the sender used. */
type BroadcastUser = NonNullable<AuthStateChangedEvent['authState']>['user'];

export function subscribeExtensionAuthState(
  toHostUser: (user: BroadcastUser) => HostUser | null,
  onChange: (user: HostUser | null) => void,
): () => void {
  const unsubscribeBroadcast = EventBus.on<AuthStateChangedEvent>('auth_state_changed', (event) => {
    onChange(isSignedInBroadcast(event) ? toHostUser(event.authState?.user) : null);
  });

  // Presence-and-falsy: a change notification only fires for a key that ACTUALLY
  // changed, so a watched key arriving with no value was cleared. There is no
  // other way to reach this callback with it present.
  //
  // And a sign-in, with no broadcast behind it (#350 review). The broadcast was
  // the only way the panel learned another user had signed in: missed, or sent
  // before the panel subscribed, the panel stayed on the previous user over the
  // new user's credential, and every request was refused for its whole life.
  // `storage.onChanged` reaches every context. It reports the sign-in when the
  // DATA OWNER becomes the session's user — written after the previous user's
  // data is purged — never on the session row alone, which lands first:
  // re-scoping then would hydrate the previous user's residue under the new one.
  let unsubscribed = false;
  const reportCompletedSignIn = () => {
    void readCompletedSignIn().then((user) => {
      if (user && !unsubscribed) onChange(toHostUser(user));
    });
  };
  const unsubscribeStorage = extensionStore.subscribe([AUTH_STATE_KEY, DATA_OWNER_KEY], (changed) => {
    if (AUTH_STATE_KEY in changed && !changed[AUTH_STATE_KEY]) {
      onChange(null);
      return;
    }
    if (DATA_OWNER_KEY in changed && changed[DATA_OWNER_KEY]) reportCompletedSignIn();
  });

  // ONCE, on subscribing: a sign-in that completed before anyone was listening
  // — after the entry read who was signed in and before the panel mounted —
  // produces no further event. Reporting the identity already established is a
  // no-op for the panel; reporting a different one re-scopes it.
  reportCompletedSignIn();

  return () => {
    unsubscribed = true;
    unsubscribeBroadcast();
    unsubscribeStorage();
  };
}

/**
 * The user whose sign-in is COMPLETE in storage, or `null`.
 *
 * Complete means the session row and the data owner name the same user: the
 * owner is written after the previous user's at-rest data is purged, so a
 * panel re-scoping onto this user hydrates nothing of anyone else's. `null`
 * while a sign-in is still purging, when nobody is signed in, when the row
 * names no user, and when storage cannot be read.
 */
export async function readCompletedSignIn(): Promise<BroadcastUser | null> {
  try {
    const stored = (await extensionStore.get([AUTH_STATE_KEY, DATA_OWNER_KEY])) ?? {};
    const row = stored[AUTH_STATE_KEY] as { user?: BroadcastUser } | undefined;
    const owner = stored[DATA_OWNER_KEY];
    const userId = row?.user?.user_id;
    return typeof userId === 'string' && userId === owner ? (row?.user ?? null) : null;
  } catch {
    return null;
  }
}
