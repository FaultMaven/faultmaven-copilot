/**
 * Did this extension reload, and does that mean the local conversation cache
 * is gone?
 *
 * Every signal here is an extension one. `browser.runtime.id` changes when the
 * runtime context is replaced; `getManifest().version` changes on an update.
 * A web page has neither, and it has no equivalent question: reloading a page
 * does not discard the deployment's data. So this is the extension's half of
 * persistence, and `PersistenceManager` — which fetches and restores, and which
 * both hosts need — keeps none of it.
 */
import { browser } from 'wxt/browser';
import { PersistenceManager } from '../lib/utils/persistence-manager';
import { authManager } from '../lib/auth/auth-manager';
import { extensionStore } from './host/extension-store';
import { createLogger } from '../lib/utils/logger';

const log = createLogger('ExtensionReload');

/** This build's version. `getManifest` is unavailable outside an extension. */
const CURRENT_VERSION = browser.runtime.getManifest?.()?.version || '1.0.0';

/** Minimum time between recovery attempts (5 minutes). */
const RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Deterministic reload detection using reliable signals only:
 * 1. Explicit reload flag set during extension lifecycle events
 * 2. Extension version mismatch (update scenario)
 * 3. Session ID mismatch (runtime context changed)
 *
 * NOTE: Heuristic checks (structural inconsistency) removed - cannot distinguish
 * "currently loading" from "lost data", causing false positives on login flow.
 */
export async function detectExtensionReload(): Promise<boolean> {
  try {
    const isAuthenticated = await authManager.isAuthenticated();

    if (!isAuthenticated) {
      return false;
    }

    const stored = await extensionStore.get([
      'conversationTitles',
      'conversations',
      PersistenceManager.VERSION_KEY,
      PersistenceManager.RELOAD_FLAG_KEY,
      PersistenceManager.SESSION_ID_KEY,
      PersistenceManager.LAST_RECOVERY_KEY,
    ]) as Record<string, any>;

    // Check recovery cooldown - prevent excessive recovery attempts
    const lastRecovery = stored[PersistenceManager.LAST_RECOVERY_KEY];
    if (lastRecovery) {
      const timeSinceLastRecovery = Date.now() - lastRecovery;
      if (timeSinceLastRecovery < RECOVERY_COOLDOWN_MS) {
        log.info('Recovery cooldown active', {
          timeSinceLastRecovery: `${Math.round(timeSinceLastRecovery / 1000)}s`,
          cooldownRemaining: `${Math.round((RECOVERY_COOLDOWN_MS - timeSinceLastRecovery) / 1000)}s`
        });
        return false; // Skip recovery if cooldown is active
      }
    }

    // DETERMINISTIC SIGNALS ONLY (Reliable)
    // Method 1: Explicit reload flag (most reliable)
    const hasReloadFlag = !!stored[PersistenceManager.RELOAD_FLAG_KEY];

    // Method 2: Version mismatch (extension update)
    const versionMismatch = stored[PersistenceManager.VERSION_KEY] !== CURRENT_VERSION;

    // Method 3: Session ID mismatch (runtime context changed)
    const currentSessionId = browser.runtime.id;
    const sessionMismatch = stored[PersistenceManager.SESSION_ID_KEY] &&
      stored[PersistenceManager.SESSION_ID_KEY] !== currentSessionId;

    // Recovery needed if ANY DETERMINISTIC indicator is true
    const shouldRecover = hasReloadFlag || versionMismatch || sessionMismatch;

    log.info('Reload detection', {
      isAuthenticated,
      shouldRecover,
      indicators: {
        reloadFlag: hasReloadFlag,
        versionMismatch,
        sessionMismatch
      },
      state: {
        titleCount: stored.conversationTitles ? Object.keys(stored.conversationTitles).length : 0,
        conversationCount: stored.conversations ? Object.keys(stored.conversations).length : 0,
        version: stored[PersistenceManager.VERSION_KEY],
        currentVersion: CURRENT_VERSION,
        sessionId: stored[PersistenceManager.SESSION_ID_KEY],
        currentSessionId
      },
      reason: shouldRecover ? (
        hasReloadFlag ? 'explicit_reload_flag' :
          versionMismatch ? 'version_mismatch' :
            'session_id_mismatch'
      ) : 'no_recovery_needed'
    });

    return shouldRecover;

  } catch (error) {
    log.warn('Detection error - defaulting to safe recovery:', error);
    return true;
  }
}

/**
 * Sets reload flag (called during extension lifecycle events)
 * Should be called from background script or service worker on install/update
 */
export async function markReloadDetected(): Promise<void> {
  try {
    await extensionStore.set({
      [PersistenceManager.RELOAD_FLAG_KEY]: true,
      [PersistenceManager.SESSION_ID_KEY]: browser.runtime.id
    });
    log.info('Reload flag set');
  } catch (error) {
    log.warn('Failed to set reload flag:', error);
  }
}

/** Clears the reload flag after a successful recovery. */
export async function clearReloadFlag(): Promise<void> {
  try {
    await extensionStore.remove([PersistenceManager.RELOAD_FLAG_KEY]);
    log.info('Reload flag cleared');
  } catch (error) {
    log.warn('Failed to clear reload flag:', error);
  }
}

/**
 * Record THIS runtime as the one the stored data belongs to.
 *
 * Written after every startup, not only after a recovery: the version and the
 * runtime id are what make the NEXT load not look like a reload, and leaving
 * them stale would re-detect the same reload on every launch until a recovery
 * happened to run. It used to be stamped inside `PersistenceManager`, which
 * knew neither value except by reaching for `browser`.
 */
export async function stampRuntimeIdentity(): Promise<void> {
  try {
    await extensionStore.set({
      [PersistenceManager.VERSION_KEY]: CURRENT_VERSION,
      [PersistenceManager.SESSION_ID_KEY]: browser.runtime.id
    });
  } catch (error) {
    log.warn('Failed to record the runtime identity:', error);
  }
}
