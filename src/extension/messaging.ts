/**
 * Cross-context messaging, for the extension.
 *
 * `runtime.sendMessage` / `runtime.onMessage` is how the background worker, the
 * side panel and the content scripts reach each other. It is not a shared
 * mechanism: a web page has no equivalent, and inventing one for it would be
 * building a transport for messages nothing sends. What the shared UI actually
 * needed from this — "the signed-in identity changed elsewhere" — is a member
 * on `HostSession` now, and this file is the extension's side of it.
 *
 * It carried four event types. Three of them — `session_expired`,
 * `case_updated`, `data_uploaded` — had zero emitters and zero consumers in the
 * whole tree, so they described a system that did not exist; they are gone
 * rather than moved.
 */
import { browser } from 'wxt/browser';
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';

const log = createLogger('EventBus');

export type EventType = 'auth_state_changed';

export interface BaseEvent {
  type: EventType;
  timestamp?: number;
}

/**
 * Who is signed in, as the extension broadcasts it.
 *
 * `authState: null` means signed out. The `{ isAuthenticated, user }` wrapper is
 * the contract the background, the local sign-in and the logout path all send;
 * a raw user object here once left the panel's auth flag `undefined`.
 */
export interface AuthStateChangedEvent extends BaseEvent {
  type: 'auth_state_changed';
  authState: {
    /**
     * `true`, always — a sign-out is `authState: null`, not a flag set false.
     *
     * Declared as the literal rather than `boolean` so the second spelling is
     * unrepresentable at the emitters. With `boolean` there were two ways to
     * say "signed out", one of which is a TRUTHY object, and a reader that
     * tested `authState` for presence read it as a sign-in. Every emitter
     * already conformed; this is what stops the next one not conforming.
     */
    isAuthenticated: true;
    user?: {
      user_id: string;
      username: string;
      display_name?: string;
      email?: string;
      roles?: string[];
    };
  } | null;
}

/**
 * Does this broadcast say somebody is signed in?
 *
 * The one place that decides, because three readers decide it — the sign-in
 * screen, the entry's startup listener and `subscribeExtensionAuthState` — and
 * they were keeping three hand-written copies of the answer in agreement.
 *
 * It re-checks a field the type above already constrains, and that is the
 * point: what arrives here came off `runtime.onMessage` and is only as
 * well-formed as the sender was. The type governs what THIS extension writes;
 * this governs what a reader believes.
 */
export function isSignedInBroadcast(event: AuthStateChangedEvent): boolean {
  return event.authState?.isAuthenticated === true;
}

export type AppEvent = AuthStateChangedEvent;

type EventHandler<T extends AppEvent> = (event: T) => void;

export const EventBus = {
  /** Broadcast to every other context. Never to this one — a sender does not
   *  receive its own message, so a context that must also react does so itself. */
  emit(event: AppEvent): Promise<void> {
    const payload = { ...event, timestamp: Date.now() };
    log.debug('Emitting event', payload);
    return browser.runtime.sendMessage(payload).catch(err => {
      // Ignore "Receiving end does not exist" errors which happen when no listeners are active
      if (!err.message?.includes('Receiving end does not exist')) {
        log.warn('Failed to emit event', err);
      }
    });
  },

  /** Listen. Returns a cleanup function that removes the listener. */
  on<T extends AppEvent>(eventType: EventType, handler: EventHandler<T>): () => void {
    const listener = (message: any) => {
      if (message && message.type === eventType) {
        handler(message as T);
      }
    };

    browser.runtime.onMessage.addListener(listener);
    log.debug(`Listener added for ${eventType}`);

    return () => {
      browser.runtime.onMessage.removeListener(listener);
      log.debug(`Listener removed for ${eventType}`);
    };
  }
};
