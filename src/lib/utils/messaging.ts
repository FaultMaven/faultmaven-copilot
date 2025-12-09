import { browser } from "wxt/browser";
import { createLogger } from "./logger";

const log = createLogger('EventBus');

export type EventType = 
  | 'auth_state_changed' 
  | 'session_expired' 
  | 'case_updated'
  | 'data_uploaded';

export interface BaseEvent {
  type: EventType;
  timestamp?: number;
}

export interface AuthStateChangedEvent extends BaseEvent {
  type: 'auth_state_changed';
  authState: {
    isAuthenticated: boolean;
    user?: any;
  } | null;
}

export interface SessionExpiredEvent extends BaseEvent {
  type: 'session_expired';
}

export type AppEvent = AuthStateChangedEvent | SessionExpiredEvent | BaseEvent;

type EventHandler<T extends AppEvent> = (event: T) => void;

/**
 * Typed Event Bus for cross-component communication (SidePanel <-> Background <-> Content)
 */
export const EventBus = {
  /**
   * Broadcast an event to all parts of the extension
   */
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

  /**
   * Listen for specific events
   * Returns a cleanup function to remove the listener
   */
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

/**
 * Legacy support for direct message sending
 */
export async function sendMessageToBackground(message: any): Promise<any> {
  try {
    return await browser.runtime.sendMessage(message);
  } catch (error) {
    console.error("Error sending message to background:", error, "Message:", message);
    throw error;
  }
}
