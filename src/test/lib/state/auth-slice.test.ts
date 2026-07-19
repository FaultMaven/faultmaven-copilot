import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../../lib/state/store';
import * as api from '../../../lib/api';
import { EventBus } from '../../../lib/utils/messaging';

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
  devLogin: vi.fn(),
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
