/**
 * A host that embeds the panel owns onboarding.
 *
 * First-run onboarding is the EXTENSION's: a fresh install must choose an
 * endpoint before anything can be fetched, so `initializeApp` refused to load
 * capabilities until `hasCompletedFirstRun` was set. A host that embeds the
 * panel has already onboarded its user and already knows where its backend is —
 * it never sets that flag, so capabilities stayed permanently unloaded and the
 * only way round it was for the host to reach into storage and write another
 * host's onboarding key itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { setHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';

const loadCapabilities = vi.fn(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  // A host that has NOT been through the extension's first-run flow.
  setHostStore({
    get: async () => ({}),
    set: async () => {},
    remove: async () => {},
    subscribe: () => () => {},
  });
  setHostEndpoints({
    apiUrl: async () => 'https://app.faultmaven.ai',
    dashboardUrl: async () => 'https://app.faultmaven.ai',
    subscribe: () => () => {},
  });
  useAppStore.setState({ initializingCapabilities: true, loadCapabilities } as never);
});

describe('the onboarding gate', () => {
  it('stops an un-onboarded host by default — the extension flow is unchanged', async () => {
    await useAppStore.getState().initializeApp();

    expect(loadCapabilities).not.toHaveBeenCalled();
    expect(useAppStore.getState().initializingCapabilities).toBe(false);
  });

  it('is skipped for a host that embeds the panel', async () => {
    await useAppStore.getState().initializeApp({ skipOnboardingGate: true });

    expect(loadCapabilities).toHaveBeenCalledTimes(1);
  });

  // The point of the flag: no host should have to write another host's key.
  it('the embedded host never writes hasCompletedFirstRun', async () => {
    const set = vi.fn(async (_items: Record<string, unknown>) => {});
    setHostStore({
      get: async () => ({}),
      set,
      remove: async () => {},
      subscribe: () => () => {},
    });

    await useAppStore.getState().initializeApp({ skipOnboardingGate: true });

    const wrote = set.mock.calls.flatMap(([items]) => Object.keys(items ?? {}));
    expect(wrote).not.toContain('hasCompletedFirstRun');
    expect(loadCapabilities).toHaveBeenCalledTimes(1);
  });

  // …and an onboarded extension still loads them, so the skip is not doing the
  // work the flag was doing.
  it('an onboarded host loads capabilities with the gate in place', async () => {
    setHostStore({
      get: async () => ({ hasCompletedFirstRun: true }),
      set: async () => {},
      remove: async () => {},
      subscribe: () => () => {},
    });

    await useAppStore.getState().initializeApp();

    expect(loadCapabilities).toHaveBeenCalledTimes(1);
  });
});
