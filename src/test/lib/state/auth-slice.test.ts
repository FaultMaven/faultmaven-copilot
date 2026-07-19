import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../../lib/state/store';
import * as api from '../../../lib/api';
import { EventBus } from '../../../lib/utils/messaging';
import { shouldReloadOnAuthIdentitySwitch } from '../../../lib/state/slices/auth-slice';

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
    runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) }
  }
}));

vi.mock('../../../lib/api', () => ({
  logoutAuth: vi.fn(),
  authManager: { isAuthenticated: vi.fn().mockResolvedValue(false) }
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

// #164: a shared-profile identity switch performed in another context reaches an
// open panel only as an authenticated broadcast. When the panel is ALREADY
// authenticated as a different user, nothing else resets the in-memory case-state
// slices (AuthScreen, which reloads on login into a logged-OUT panel, is not
// mounted), so the panel must reload to re-scope.
describe('shouldReloadOnAuthIdentitySwitch (#164)', () => {
  it('reloads on an A→B switch under an already-authenticated panel', () => {
    expect(
      shouldReloadOnAuthIdentitySwitch(true, 'userA', { isAuthenticated: true, user: { user_id: 'userB' } })
    ).toBe(true);
  });

  it('does NOT reload when the panel was logged out (AuthScreen reloads that path)', () => {
    expect(
      shouldReloadOnAuthIdentitySwitch(false, undefined, { isAuthenticated: true, user: { user_id: 'userB' } })
    ).toBe(false);
  });

  it('does NOT reload for the same user (token refresh / re-broadcast)', () => {
    expect(
      shouldReloadOnAuthIdentitySwitch(true, 'userA', { isAuthenticated: true, user: { user_id: 'userA' } })
    ).toBe(false);
  });

  it('does NOT reload on an unauthenticated or null broadcast', () => {
    expect(shouldReloadOnAuthIdentitySwitch(true, 'userA', { isAuthenticated: false })).toBe(false);
    expect(shouldReloadOnAuthIdentitySwitch(true, 'userA', null)).toBe(false);
  });

  it('does NOT reload when the incoming identity is missing', () => {
    expect(
      shouldReloadOnAuthIdentitySwitch(true, 'userA', { isAuthenticated: true, user: {} })
    ).toBe(false);
  });
});
