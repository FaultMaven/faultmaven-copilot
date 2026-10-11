/**
 * The extension's answers to what the API layer needs.
 *
 * Each of these was previously read by the API client itself. Naming them here
 * is what lets a second host answer differently — and, more immediately, what
 * takes the shared client out of the business of tearing down a credential it
 * does not own.
 */
import { getApiUrl } from './endpoints';
import { extensionStore } from './extension-store';
import { setApiTransport, type ApiTransport } from '@faultmaven/copilot-ui/lib/api/transport';
import { clearPersistedSession } from '@faultmaven/copilot-ui/lib/api/session-core';
import type { HostSession } from '@faultmaven/copilot-ui/shared/host';
import { endSessionOnRejectedCredential } from './session-credential';

export function createExtensionTransport(session: HostSession): ApiTransport {
  return {
    baseUrl: () => getApiUrl(),

    // The session's own answer, and only it: `HostSession.accessToken()` is what
    // the HostAdapter contract says the package asks. The extension's session
    // answers it for its user (`readSessionAccessToken(user.id)`, copilot#350),
    // so a credential another user's sign-in has put in storage is refused, not
    // sent.
    accessToken: () => session.accessToken(),

    // Through the same store everything else reads and writes this key from.
    // A direct `browser.storage.local` read here would work in the extension
    // and be a second storage path by another name.
    async sessionId() {
      const stored = await extensionStore.get(['sessionId']);
      return (stored.sessionId as string | undefined) ?? null;
    },

    // Delegated, not reimplemented: which keys a session occupies is
    // `session-core`'s to know, and it is the single writer of them. `clientId`
    // survives, so a fresh /sessions POST can resume rather than start cold.
    clearSession: () => clearPersistedSession(),

    // Straight to the act-site with the bearer the rejected request carried,
    // so the teardown can tell a verdict on THIS session from one on a session
    // a sign-in has since replaced (copilot#346). `HostSession.onUnauthorized`
    // cannot carry it — that signature is shared with the Dashboard host.
    // The user is the session's: every request this transport sends was built
    // for it, so a newer credential belonging to anyone else is never a
    // continuation of the rejected one.
    onUnauthorized: (rejectedBearer) =>
      endSessionOnRejectedCredential(rejectedBearer, session.user?.id ?? null),
  };
}

/** Install it. Called once the extension has a session. */
export function installExtensionTransport(session: HostSession): void {
  setApiTransport(createExtensionTransport(session));
}
