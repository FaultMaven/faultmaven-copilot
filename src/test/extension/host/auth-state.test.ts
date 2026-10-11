/**
 * Two mechanisms, one fact.
 *
 * A sign-in or sign-out completed in another context BROADCASTS. A credential
 * can also simply be CLEARED, with the storage key going and no broadcast to go
 * with it — a hard 401 torn down in the background is that case, and it is the
 * one the shared store used to watch for by naming `authState` itself. Both are
 * answered here, and only `HostUser | null` crosses the boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBrowser } = vi.hoisted(() => ({
  mockBrowser: {
    storage: {
      local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  },
}));

vi.mock('wxt/browser', () => ({ browser: mockBrowser }));

import { subscribeExtensionAuthState } from '../../../extension/host/auth-state';
import type { HostUser } from '@faultmaven/copilot-ui/shared/host';

const toHostUser = (user: any): HostUser | null =>
  user?.user_id ? { id: user.user_id, username: user.username, roles: user.roles ?? [] } : null;

const deliverBroadcast = (message: unknown) =>
  mockBrowser.runtime.onMessage.addListener.mock.calls.at(-1)![0](message);

const deliverStorageChange = (changes: Record<string, { newValue?: unknown }>) =>
  mockBrowser.storage.onChanged.addListener.mock.calls.at(-1)![0](changes, 'local');

describe('the extension reports auth-state changes', () => {
  let onChange: any;

  beforeEach(() => {
    vi.clearAllMocks();
    onChange = vi.fn();
  });

  it('reports the user when a sign-in is broadcast', () => {
    subscribeExtensionAuthState(toHostUser, onChange);

    deliverBroadcast({
      type: 'auth_state_changed',
      authState: { isAuthenticated: true, user: { user_id: 'u1', username: 'op', roles: ['user'] } },
    });

    expect(onChange).toHaveBeenCalledWith({ id: 'u1', username: 'op', roles: ['user'] });
  });

  it('reports nobody when a sign-out is broadcast', () => {
    subscribeExtensionAuthState(toHostUser, onChange);

    deliverBroadcast({ type: 'auth_state_changed', authState: null });

    expect(onChange).toHaveBeenCalledWith(null);
  });

  // The leg with no broadcast behind it. Without this a credential cleared in
  // another context leaves the panel acting as though it still had one, which
  // is exactly what the storage watch in the shared store was there to prevent.
  it('reports nobody when the credential key is cleared with no broadcast', () => {
    subscribeExtensionAuthState(toHostUser, onChange);

    deliverStorageChange({ authState: { newValue: undefined } });

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('says nothing when an unrelated key changes', () => {
    subscribeExtensionAuthState(toHostUser, onChange);

    deliverStorageChange({ faultmaven_current_case: { newValue: 'case-1' } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('says nothing when the credential key is WRITTEN rather than cleared', () => {
    subscribeExtensionAuthState(toHostUser, onChange);

    deliverStorageChange({ authState: { newValue: { access_token: 'x' } } });

    expect(onChange).not.toHaveBeenCalled();
  });

  // ---- An identity switch with no broadcast behind it (#350 review) ----
  //
  // The broadcast used to be the ONLY way the panel learned another user had
  // signed in. Missed — or sent before the panel subscribed — the panel stayed
  // A over B's credential, and every request was refused for its whole life.
  // `storage.onChanged` reaches every context; the sign-in is COMPLETE once the
  // data owner is the new user (written after the prior user's data is purged),
  // and only then is it safe to re-scope onto it.
  const B_ROW = { access_token: 'b', user: { user_id: 'u2', username: 'other', roles: ['user'] } };
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it("reports the new user once their sign-in is complete, with no broadcast", async () => {
    mockBrowser.storage.local.get.mockResolvedValue({ authState: B_ROW, faultmaven_data_owner_id: 'u2' });
    subscribeExtensionAuthState(toHostUser, onChange);
    await flush();
    onChange.mockClear();

    deliverStorageChange({ faultmaven_data_owner_id: { newValue: 'u2' } });
    await flush();

    expect(onChange).toHaveBeenCalledWith({ id: 'u2', username: 'other', roles: ['user'] });
  });

  it("says nothing while the previous user's data is still being purged", async () => {
    // The row is B's, the owner still A's: re-scoping now would hydrate A's
    // residue under B. The owner write that follows the purge is the signal.
    mockBrowser.storage.local.get.mockResolvedValue({ authState: B_ROW, faultmaven_data_owner_id: 'u1' });
    subscribeExtensionAuthState(toHostUser, onChange);
    await flush();

    deliverStorageChange({ authState: { newValue: B_ROW } });
    await flush();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports a sign-in that completed BEFORE the subscription (the startup gap)', async () => {
    // B signed in after the entry read A at startup and before the panel
    // subscribed: no event will ever arrive for it, so subscribing reads once.
    mockBrowser.storage.local.get.mockResolvedValue({ authState: B_ROW, faultmaven_data_owner_id: 'u2' });

    subscribeExtensionAuthState(toHostUser, onChange);
    await flush();

    expect(onChange).toHaveBeenCalledWith({ id: 'u2', username: 'other', roles: ['user'] });
  });

  it('detaches both listeners on unsubscribe', () => {
    const unsubscribe = subscribeExtensionAuthState(toHostUser, onChange);

    unsubscribe();

    expect(mockBrowser.runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
    expect(mockBrowser.storage.onChanged.removeListener).toHaveBeenCalledTimes(1);
  });
});
