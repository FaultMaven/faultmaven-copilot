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
import { setApiTransport, type ApiTransport } from '../../lib/api/transport';
import { clearPersistedSession } from '../../lib/api/session-core';
import type { HostSession } from '../../shared/host';

export function createExtensionTransport(session: HostSession): ApiTransport {
  return {
    baseUrl: () => getApiUrl(),

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

    onUnauthorized: () => session.onUnauthorized(),
  };
}

/** Install it. Called once the extension has a session. */
export function installExtensionTransport(session: HostSession): void {
  setApiTransport(createExtensionTransport(session));
}
