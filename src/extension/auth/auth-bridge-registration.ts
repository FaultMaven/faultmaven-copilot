import { browser } from 'wxt/browser';
import { getHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';
import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger';

/**
 * Runtime registration of the auth-bridge content script.
 *
 * The bridge is NOT declared in the manifest. It is registered at runtime for
 * the CONFIGURED Dashboard origin only — Cloud by default, or a self-hosted /
 * custom dashboard — so it injects on exactly that origin and nowhere else
 * (previously it ran on every localhost page). Registration is reconciled at
 * startup and whenever the dashboard URL or granted host permissions change.
 */

const log = createLogger('AuthBridgeReg');
const AUTH_BRIDGE_ID = 'auth-bridge';
const AUTH_BRIDGE_JS = 'content-scripts/auth-bridge.js';

/**
 * The origin pattern the bridge must be registered for, or `null` if the
 * configured Dashboard URL is not a URL at all.
 */
export function dashboardMatchPattern(dashboardUrl: string): string | null {
  try {
    return `${new URL(dashboardUrl).origin}/*`;
  } catch {
    return null;
  }
}

/**
 * Do we hold the host permission THE BRIDGE ACTUALLY NEEDS?
 *
 * Exported because the options page asks the same question in order to offer a
 * Grant button, and two spellings of it drift in both directions at once. The
 * bridge is gated on the DASHBOARD origin alone — not on the API origin, which
 * the extension reaches from the background worker where host permissions work
 * differently. A union of the two reports a broken install to someone whose
 * bridge is registered and working, and stays quiet for someone whose is not.
 *
 * `false` when the URL is unusable: there is no origin to hold permission for.
 */
export async function hasDashboardOriginPermission(dashboardUrl: string): Promise<boolean> {
  const matchPattern = dashboardMatchPattern(dashboardUrl);
  if (!matchPattern) return false;
  return browser.permissions.contains({ origins: [matchPattern] });
}

export async function unregisterAuthBridge(): Promise<void> {
  try {
    await browser.scripting.unregisterContentScripts({ ids: [AUTH_BRIDGE_ID] });
  } catch {
    // Not registered — nothing to remove.
  }
}

// Serialize reconciles: startup + storage.onChanged + permission events can
// fire concurrently, and two overlapping runs could both try to register the
// same script id. Chaining keeps them sequential so the get→register check is
// consistent. doReconcile never rejects (it catches internally), so the chain
// stays resolved.
let reconcileChain: Promise<void> = Promise.resolve();

export function reconcileAuthBridgeRegistration(): Promise<void> {
  reconcileChain = reconcileChain.then(doReconcile);
  return reconcileChain;
}

async function doReconcile(): Promise<void> {
  try {
    const dashboardUrl = await getHostEndpoints().dashboardUrl();
    const matchPattern = dashboardMatchPattern(dashboardUrl);
    if (!matchPattern) {
      log.warn('Invalid dashboard URL, skipping registration', { dashboardUrl });
      return;
    }

    // Only register where we hold host permission; the bridge can't run there
    // otherwise. It registers once permission is granted or the URL changes.
    // Same predicate the options page offers its Grant button on.
    const hasPerm = await hasDashboardOriginPermission(dashboardUrl);
    if (!hasPerm) {
      await unregisterAuthBridge();
      log.info('No host permission for dashboard origin yet', { matchPattern });
      return;
    }

    const existing = await browser.scripting
      .getRegisteredContentScripts({ ids: [AUTH_BRIDGE_ID] })
      .catch(() => [] as any[]);
    const current = existing.find((s: any) => s.id === AUTH_BRIDGE_ID);
    if (current && current.matches?.length === 1 && current.matches[0] === matchPattern) {
      return; // already registered for the right origin
    }

    const def = {
      id: AUTH_BRIDGE_ID,
      js: [AUTH_BRIDGE_JS],
      matches: [matchPattern],
      runAt: 'document_end' as const,
    };
    if (current) {
      await browser.scripting.updateContentScripts([def]);
    } else {
      await browser.scripting.registerContentScripts([def]);
    }
    log.info('Registered auth bridge for dashboard origin', { matchPattern });
  } catch (error) {
    log.warn('Auth-bridge registration failed', error);
  }
}
