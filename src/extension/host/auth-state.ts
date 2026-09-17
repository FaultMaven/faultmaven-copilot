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
import { AUTH_STATE_KEY } from '../auth/storage-keys';
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
  const unsubscribeStorage = extensionStore.subscribe([AUTH_STATE_KEY], (changed) => {
    if (AUTH_STATE_KEY in changed && !changed[AUTH_STATE_KEY]) onChange(null);
  });

  return () => {
    unsubscribeBroadcast();
    unsubscribeStorage();
  };
}
