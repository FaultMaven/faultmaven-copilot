/**
 * The extension's answers to what the API layer needs.
 *
 * Each of these was previously read by the API client itself. Naming them here
 * is what lets a second host answer differently — and, more immediately, what
 * takes the shared client out of the business of tearing down a credential it
 * does not own.
 */
import { browser } from 'wxt/browser';
import { getApiUrl } from '../../config';
import { setApiTransport, type ApiTransport } from '../../lib/api/transport';
import type { HostSession } from '../../shared/host';

/**
 * The three keys a stale session occupies.
 *
 * `clientId` is deliberately NOT among them: it survives session rotation so a
 * fresh `/sessions` POST can resume rather than start cold. This is the exact
 * set the client used to remove inline.
 */
const SESSION_KEYS = ['sessionId', 'sessionCreatedAt', 'sessionResumed'];

export function createExtensionTransport(session: HostSession): ApiTransport {
  return {
    baseUrl: () => getApiUrl(),

    accessToken: () => session.accessToken(),

    async sessionId() {
      const stored = await browser.storage.local.get(['sessionId']);
      return (stored.sessionId as string | undefined) ?? null;
    },

    async clearSession() {
      await browser.storage.local.remove(SESSION_KEYS);
    },

    onUnauthorized: () => session.onUnauthorized(),
  };
}

/** Install it. Called once the extension has a session. */
export function installExtensionTransport(session: HostSession): void {
  setApiTransport(createExtensionTransport(session));
}
