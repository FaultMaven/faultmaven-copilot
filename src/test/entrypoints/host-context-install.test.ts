/**
 * Every extension context installs the host's store and endpoints, at its entry
 * point, before anything can read them.
 *
 * This is the assertion the rest of the migration rests on. `src/lib` no longer
 * reaches `browser.storage.local` for state or for the configured endpoint: it
 * asks module singletons that a host installs. The side panel is not the only
 * context that needs them — the background worker exchanges an authorization
 * code and refreshes tokens against the CONFIGURED API URL, and the options page
 * reads and writes that URL and probes capabilities.
 *
 * A context that skipped the install would not crash. `getApiUrl()` used to
 * catch the failure and answer with the Cloud default, so a self-hosted
 * deployment's worker would quietly talk to api.faultmaven.ai. Both halves are
 * pinned here: the wiring is installed, and (in endpoints.test.ts) a missing
 * store now throws instead of guessing.
 *
 * Done in a FRESH module graph. The suite-wide defaults in setup.ts are
 * installed into the graph this file was loaded in, so an entry point that
 * installed nothing would still find them there and this would pass having
 * checked nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const b = () => (global as any).browser;

beforeEach(() => {
  (global as any).defineBackground = (config: any) => config;
  (global as any).defineContentScript = (config: any) => config;
  b().runtime = { ...(b().runtime ?? {}), getManifest: () => ({ version: '1.0.0' }) };
});

async function assertEntryInstallsTheHostContext(importEntry: () => Promise<unknown>) {
  vi.resetModules();

  const hostStore = await import('../../lib/host-store');
  const hostEndpoints = await import('../../lib/host-endpoints');

  // Guards the guard: in this fresh graph nothing is installed yet, so a pass
  // below cannot be setup.ts's defaults answering for the entry point.
  expect(() => hostStore.getHostStore()).toThrow(/No HostStore installed/);
  expect(() => hostEndpoints.getHostEndpoints()).toThrow(/No HostEndpoints installed/);

  await importEntry();

  expect(() => hostStore.getHostStore()).not.toThrow();
  expect(() => hostEndpoints.getHostEndpoints()).not.toThrow();
}

describe('each extension entry point installs the host context', () => {
  it('the background worker does', async () => {
    await assertEntryInstallsTheHostContext(() => import('../../entrypoints/background'));
  });

  it('the options page does', async () => {
    await assertEntryInstallsTheHostContext(() => import('../../entrypoints/options/main'));
  });

  it('the side panel does', async () => {
    await assertEntryInstallsTheHostContext(
      () => import('../../entrypoints/sidepanel_manual/main'),
    );
  });
});
