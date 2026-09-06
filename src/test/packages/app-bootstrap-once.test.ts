/**
 * One bootstrap per page load, however many components ask for one.
 *
 * `initializeApp` reads first-run status and loads backend capabilities, and
 * `loadCapabilities` raises `initializingCapabilities` while it runs. A host
 * entry that renders a loading screen on that flag — the extension's
 * `ExtensionApp` does, so the sign-in form cannot flash during startup —
 * UNMOUNTS the panel while it is true. So a second bootstrap is not merely
 * duplicated work: mount → initializeApp → flag true → the entry swaps the
 * panel out → unmount → capabilities settle → flag false → remount →
 * initializeApp → …
 *
 * That is what #240 shipped when it split the entry out of the shared UI and
 * left both halves bootstrapping. The panel remounted for as long as the
 * renderer survived, refetching capabilities on every cycle, and the side-panel
 * document died under it — Extension E2E has been red on main since 2026-09-04.
 *
 * The guard is in the bootstrap rather than in either caller on purpose, so it
 * is a property of `initializeApp` instead of an arrangement two components have
 * to keep. Neither half was visible to a test that mocks the other: the entry's
 * own suite stubs `CopilotPanel` with a probe, which is how 707 unit tests
 * stayed green while the E2E went red.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { setHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';
import {
  hasAppBootstrapped,
  resetAppBootstrap,
} from '@faultmaven/copilot-ui/lib/state/app-bootstrap';

const loadCapabilities = vi.fn(async () => {
  // What the real one does to the flag, which is the whole hazard.
  useAppStore.setState({ initializingCapabilities: true } as never);
  useAppStore.setState({ initializingCapabilities: false } as never);
});

const onboarded = (hasCompletedFirstRun: boolean) =>
  setHostStore({
    get: async () => (hasCompletedFirstRun ? { hasCompletedFirstRun: true } : {}),
    set: async () => {},
    remove: async () => {},
    subscribe: () => () => {},
  });

beforeEach(() => {
  vi.clearAllMocks();
  onboarded(true);
  setHostEndpoints({
    apiUrl: async () => 'https://app.faultmaven.ai',
    dashboardUrl: async () => 'https://app.faultmaven.ai',
    subscribe: () => () => {},
  });
  resetAppBootstrap();
  useAppStore.setState({
    loadCapabilities,
    initializingCapabilities: true,
  } as never);
});

describe('the app bootstrap runs once per page load', () => {
  it('does the work for the first caller only', async () => {
    await useAppStore.getState().initializeApp();
    await useAppStore.getState().initializeApp();
    await useAppStore.getState().initializeApp();

    expect(
      loadCapabilities,
      'the bootstrap ran again for a second caller. The extension entry gates ' +
        'on `initializingCapabilities`, so a repeat run unmounts the component ' +
        'that asked for it, and the remount asks again (#251).',
    ).toHaveBeenCalledTimes(1);
  });

  /**
   * The mechanism, stated directly: a repeat call must not put the app back
   * into `initializingCapabilities`. That flag going true again is what
   * unmounts the panel; a call that never raises it cannot start the cycle
   * however many times a remount repeats it.
   */
  it('a repeat call never puts the app back into `initializing`', async () => {
    await useAppStore.getState().initializeApp();
    expect(useAppStore.getState().initializingCapabilities).toBe(false);

    const flags: boolean[] = [];
    const unsubscribe = useAppStore.subscribe((s) =>
      flags.push(s.initializingCapabilities),
    );
    await useAppStore.getState().initializeApp({ skipOnboardingGate: true });
    unsubscribe();

    expect(flags.filter(Boolean)).toEqual([]);
    expect(useAppStore.getState().initializingCapabilities).toBe(false);
  });

  /**
   * The onboarding gate turns a host away WITHOUT bootstrapping anything, so it
   * must not latch. A fresh extension install is exactly this: the entry's
   * first call is refused, the user completes the first-run flow, and the
   * capabilities still have to load.
   */
  it('does not latch when the onboarding gate turned the caller away', async () => {
    onboarded(false);

    await useAppStore.getState().initializeApp();
    expect(loadCapabilities).not.toHaveBeenCalled();
    expect(hasAppBootstrapped()).toBe(false);

    // First run completed; the next caller must still get to bootstrap.
    onboarded(true);
    await useAppStore.getState().initializeApp();

    expect(loadCapabilities).toHaveBeenCalledTimes(1);
  });
});
