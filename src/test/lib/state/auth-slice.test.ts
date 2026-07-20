import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../../lib/state/store';
import * as api from '../../../lib/api';
import { EventBus } from '../../../lib/utils/messaging';
import { shouldReloadOnAuthBroadcast } from '../../../lib/state/slices/auth-slice';

// Capture the runtime.onMessage listeners that EventBus.on registers, so a test can
// deliver an auth_state_changed broadcast to the auth-slice listener directly.
const hoisted = vi.hoisted(() => ({ messageListeners: [] as ((msg: any) => void)[] }));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined)
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() }
    },
    runtime: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: {
        addListener: vi.fn((l: (msg: any) => void) => hoisted.messageListeners.push(l)),
        removeListener: vi.fn()
      }
    }
  }
}));

vi.mock('../../../lib/api', () => ({
  logoutAuth: vi.fn(),
  authManager: {
    isAuthenticated: vi.fn().mockResolvedValue(false),
    getCurrentUser: vi.fn().mockResolvedValue(null)
  }
}));

vi.mock('../../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

// #143: logout must always complete the LOCAL logout — logoutAuth destroys the
// credential in its finally regardless of the /auth/logout POST outcome, so a
// failed POST must not leave the app half-logged-out or (via a rethrow) skip the
// caller's local data purge.
describe('auth-slice logout (#143)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      isAuthenticated: true,
      currentUser: { user_id: 'u1', username: 'alice' } as any,
      authError: null
    });
  });

  it('completes local logout and does NOT reject when the backend logout POST fails', async () => {
    (api.logoutAuth as any).mockRejectedValue(new Error('Server error 500'));
    const emit = vi.spyOn(EventBus, 'emit');

    await expect(useAppStore.getState().logout()).resolves.toBeUndefined();

    expect(useAppStore.getState().isAuthenticated).toBe(false);
    expect(useAppStore.getState().currentUser).toBeNull();
    expect(emit).toHaveBeenCalledWith({ type: 'auth_state_changed', authState: null });
  });

  it('completes local logout on a successful backend logout', async () => {
    (api.logoutAuth as any).mockResolvedValue(undefined);
    const emit = vi.spyOn(EventBus, 'emit');

    await useAppStore.getState().logout();

    expect(api.logoutAuth).toHaveBeenCalled();
    expect(useAppStore.getState().isAuthenticated).toBe(false);
    expect(emit).toHaveBeenCalledWith({ type: 'auth_state_changed', authState: null });
  });
});

// #164: a login/identity-switch performed in another context reaches an open panel
// only as an authenticated broadcast. The panel must reload to re-scope its
// in-memory case-state slices whenever that broadcast establishes a new identity
// (into a not-authenticated panel — covers the pre-AuthScreen init window) or
// switches identity (A→B under an authenticated panel). Same-user re-broadcasts
// (token refresh) must not reload.
describe('shouldReloadOnAuthBroadcast (#164)', () => {
  it('reloads on an A→B switch under an already-authenticated panel', () => {
    expect(
      shouldReloadOnAuthBroadcast(true, 'userA', { isAuthenticated: true, user: { user_id: 'userB' } })
    ).toBe(true);
  });

  it('reloads when identity is established into a not-authenticated panel (pre-AuthScreen window)', () => {
    expect(
      shouldReloadOnAuthBroadcast(false, undefined, { isAuthenticated: true, user: { user_id: 'userB' } })
    ).toBe(true);
  });

  it('does NOT reload for the same user under an authenticated panel (token refresh / re-broadcast)', () => {
    expect(
      shouldReloadOnAuthBroadcast(true, 'userA', { isAuthenticated: true, user: { user_id: 'userA' } })
    ).toBe(false);
  });

  it('does NOT reload on an unauthenticated or null broadcast', () => {
    expect(shouldReloadOnAuthBroadcast(true, 'userA', { isAuthenticated: false })).toBe(false);
    expect(shouldReloadOnAuthBroadcast(true, 'userA', null)).toBe(false);
  });

  it('does NOT reload when the incoming identity is missing', () => {
    expect(
      shouldReloadOnAuthBroadcast(true, 'userA', { isAuthenticated: true, user: {} })
    ).toBe(false);
  });
});

// The predicate above is wired into the auth-slice EventBus listener; assert the
// wiring actually issues the reload (a regression in the `if` would be invisible to
// the predicate tests alone).
describe('auth-slice broadcast listener reload wiring (#164)', () => {
  const deliver = (authState: any) =>
    hoisted.messageListeners.forEach((l) => l({ type: 'auth_state_changed', authState }));

  let reload: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    reload = vi.fn();
    // jsdom: make window.location.reload observable.
    Object.defineProperty(window, 'location', { configurable: true, value: { reload } });
    (api.authManager.isAuthenticated as any).mockResolvedValue(true);
    (api.authManager.getCurrentUser as any).mockResolvedValue({ user_id: 'userA', username: 'alice' });
    // Registers the EventBus (runtime.onMessage) listener once for the singleton store.
    await useAppStore.getState().initializeAuth();
    // Normalise the store to "authenticated as userA" regardless of prior tests.
    useAppStore.setState({ isAuthenticated: true, currentUser: { user_id: 'userA' } as any });
  });

  it('reloads the panel on an A→B identity-switch broadcast', () => {
    deliver({ isAuthenticated: true, user: { user_id: 'userB' } });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on a same-user re-broadcast', () => {
    deliver({ isAuthenticated: true, user: { user_id: 'userA' } });
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload on a logout (null authState) broadcast', () => {
    deliver(null);
    expect(reload).not.toHaveBeenCalled();
  });
});
