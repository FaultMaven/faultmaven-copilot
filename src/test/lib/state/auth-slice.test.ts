/**
 * What the shared store does when the HOST says the identity changed.
 *
 * The slice used to run the extension's auth stack: it asked `authManager` who
 * was signed in, called `logoutAuth` to sign out, and listened on
 * `runtime.onMessage` for everyone else's changes. All three are the host's, and
 * all three are why the shared tree could reach a credential. What is left is
 * the reaction, and that is what this covers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../../lib/state/store';
import { shouldReloadOnAuthChange } from '../../../lib/state/slices/auth-slice';
import { getEpoch } from '../../../lib/state/session-epoch';
import type { HostUser } from '../../../shared/host';

vi.mock('../../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

const userA: HostUser = { id: 'userA', username: 'alice', roles: ['user'] };
const userB: HostUser = { id: 'userB', username: 'bob', roles: ['user'] };

// #164: a login or identity switch performed in another context reaches an open
// panel only as this notification. The panel must reload to re-scope its
// in-memory case-state slices whenever it establishes a new identity (into a
// panel that had none — the startup window the sign-in screen is not mounted
// for) or switches identity (A→B). Same-user re-notifications must not reload.
describe('shouldReloadOnAuthChange (#164)', () => {
  it('reloads on an A→B switch under an already-signed-in panel', () => {
    expect(shouldReloadOnAuthChange(userA, userB)).toBe(true);
  });

  it('reloads when an identity is established where there was none', () => {
    expect(shouldReloadOnAuthChange(null, userB)).toBe(true);
  });

  it('does NOT reload for the same user (a token refresh, a re-broadcast)', () => {
    expect(shouldReloadOnAuthChange(userA, { ...userA, username: 'alice.renamed' })).toBe(false);
  });

  it('does NOT reload on a sign-out', () => {
    expect(shouldReloadOnAuthChange(userA, null)).toBe(false);
  });
});

// The predicate above is wired into applyHostAuthState; assert the wiring
// actually issues the reload. A regression in the `if` would be invisible to the
// predicate tests alone.
describe('applyHostAuthState', () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    reload = vi.fn();
    // jsdom: make window.location.reload observable.
    Object.defineProperty(window, 'location', { configurable: true, value: { reload } });
    useAppStore.setState({ currentUser: userA });
  });

  it('reloads the panel on an A→B identity switch', () => {
    useAppStore.getState().applyHostAuthState(userB);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().currentUser).toEqual(userB);
  });

  it('does not reload on a same-user re-notification', () => {
    useAppStore.getState().applyHostAuthState(userA);

    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload on a sign-out', () => {
    useAppStore.getState().applyHostAuthState(null);

    expect(reload).not.toHaveBeenCalled();
    expect(useAppStore.getState().currentUser).toBeNull();
  });

  // The fence, and the reason this reaction is not just a setState. A sign-out
  // that landed in another context has to invalidate the writers already
  // in flight here, or their queued continuations repopulate what the sign-out
  // is about to clear (#143).
  it('fences the session BEFORE clearing the identity', () => {
    const before = getEpoch();

    useAppStore.getState().applyHostAuthState(null);

    expect(getEpoch()).not.toBe(before);
  });

  // Startup is not an identity CHANGE: there is no prior identity for it to be a
  // change from. Routing it through applyHostAuthState would reload the panel on
  // every launch, which is why the host has a separate door.
  it('setSignedInUser establishes an identity without reloading', () => {
    useAppStore.setState({ currentUser: null });

    useAppStore.getState().setSignedInUser(userB);

    expect(useAppStore.getState().currentUser).toEqual(userB);
    expect(reload).not.toHaveBeenCalled();
  });
});
