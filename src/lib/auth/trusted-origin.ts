import { browser } from 'wxt/browser';

/**
 * Trusted Dashboard origin for the auth bridge.
 *
 * The auth bridge only forwards login state from the Dashboard. Rather than a
 * hardcoded multi-port allowlist (which blindly trusted several localhost
 * ports), trust is computed from the *configured* deployment:
 * - the Cloud default Dashboard origin (always trusted, zero-config), and
 * - the explicitly-configured `dashboardUrl` origin (self-hosted).
 *
 * This narrows trust so an unrelated app that happens to share a localhost port
 * the user is not actually using as their Dashboard is not trusted.
 */
export const CLOUD_DASHBOARD_ORIGIN = 'https://app.faultmaven.ai';

export async function isTrustedDashboardOrigin(origin: string): Promise<boolean> {
  if (origin === CLOUD_DASHBOARD_ORIGIN) return true;
  try {
    const stored = await browser.storage.local.get(['dashboardUrl']);
    const configured = stored?.dashboardUrl as string | undefined;
    if (configured) {
      return origin === new URL(configured).origin;
    }
  } catch {
    // storage unavailable — treat as untrusted
  }
  return false;
}
