/**
 * `sessionId` has exactly one writer, and one clearer.
 *
 * It had four. `session-core.persistSession` wrote it; the session slice, the
 * extension transport and the identity-change purge each REMOVED it with their
 * own idea of which keys a session occupies — and the four lists had already
 * drifted over whether `clientId` is one of them. Nothing failed, because in the
 * extension all four landed in the same store; the cost was that "what does
 * ending a session clear" depended on who ended it.
 *
 * Proved the way the active-case pointer was proved in the previous step: with
 * TWO stores. `session-core` gets the host store; everything else keeps its old
 * channel, `browser.storage.local`, wired to a different one. A writer that
 * still owns its own key list writes to the wrong store, and that is visible
 * here — where "the value ended up right" would not be, because in one store
 * both writers agree by construction.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { createStubHost } from '../support/host';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { refreshSession } from '@faultmaven/copilot-ui/lib/api/session-core';
import { createExtensionTransport } from '../../extension/host/extension-transport';
import { clientSessionManager } from '@faultmaven/copilot-ui/lib/session/client-session-manager';
import { enforceUserDataScope } from '../../extension/auth/user-scope';
import type { HostSession } from '@faultmaven/copilot-ui/shared/host';

const SESSION_KEYS = ['sessionId', 'sessionCreatedAt', 'sessionResumed'];

/** The other store: what every non-owner path used to reach for. */
const otherStore = () => (global as any).browser.storage.local;

/** Every key any write on the OTHER store touched. */
function keysWrittenElsewhere(): string[] {
  const fromSet = otherStore().set.mock.calls.flatMap(([items]: [Record<string, unknown>]) =>
    items ? Object.keys(items) : [],
  );
  const fromRemove = otherStore().remove.mock.calls.flatMap(([keys]: [string[] | string]) =>
    Array.isArray(keys) ? keys : [keys],
  );
  return [...fromSet, ...fromRemove];
}

const stubSession: HostSession = {
  user: { id: 'u1', username: 'operator', roles: ['user'] },
  accessToken: async () => 'token',
  signOut: null,
  onUnauthorized: () => {},
  subscribeAuthState: () => () => {},
};

describe('the session pointer has a single writer', () => {
  let owner: ReturnType<typeof createStubHost>;

  beforeEach(() => {
    vi.clearAllMocks();
    owner = createStubHost();
    setHostStore(owner.store);
    // Force the in-context single-flight path (no Web Locks in the test env).
    if (typeof navigator !== 'undefined') delete (navigator as any).locks;
    vi.spyOn(clientSessionManager, 'createSessionWithRecovery').mockResolvedValue({
      session_id: 'sess-1',
      created_at: '2026-02-20T00:00:00Z',
      status: 'active',
      user_id: 'u1',
      session_type: 'troubleshooting',
      client_id: 'client-1',
      session_resumed: false,
      message: 'Session created successfully',
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const writesOfSessionId = () =>
    owner.set.mock.calls.filter(([items]) => items && 'sessionId' in items);

  it('is written exactly once when a session is minted, and on the owner store', async () => {
    await refreshSession();

    const writes = writesOfSessionId();
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toMatchObject({ sessionId: 'sess-1', clientId: 'client-1' });
    expect(owner.data.sessionId).toBe('sess-1');
    expect(keysWrittenElsewhere()).not.toContain('sessionId');
  });

  it("the slice's teardown clears through the owner, clientId included", async () => {
    useAppStore.setState({ sessionId: 'sess-1', isSessionInitialized: true });

    await useAppStore.getState().clearSession();

    expect(owner.remove).toHaveBeenCalledWith([...SESSION_KEYS, 'clientId']);
    expect(keysWrittenElsewhere()).not.toContain('sessionId');
  });

  // The one real distinction between the clears, and the reason the lists had
  // drifted: `clientId` OUTLIVES a session so a fresh /sessions POST can resume
  // rather than start cold. The transport's clear must not take it.
  it("the transport's clear goes to the owner and PRESERVES clientId", async () => {
    owner.data.clientId = 'client-1';

    await createExtensionTransport(stubSession).clearSession();

    expect(owner.remove).toHaveBeenCalledWith(SESSION_KEYS);
    expect(owner.data.clientId).toBe('client-1');
    expect(keysWrittenElsewhere()).not.toContain('sessionId');
  });

  // The fourth list. An identity change on a shared profile must drop the prior
  // user's session pointer — through the owner, not through a list of its own.
  it('the identity-change purge clears through the owner', async () => {
    otherStore().get.mockResolvedValue({
      faultmaven_data_owner_id: 'a-different-user',
      faultmaven_current_case: 'case-1',
    });

    const purged = await enforceUserDataScope('u1');

    expect(purged).toBe(true);
    expect(owner.remove).toHaveBeenCalledWith([...SESSION_KEYS, 'clientId']);
    // The client id ClientSessionManager owns and presents to resume is a
    // different key from the one session-core mirrors, so both go.
    expect(owner.remove).toHaveBeenCalledWith(['faultmaven_client_id']);
    expect(keysWrittenElsewhere()).not.toContain('sessionId');
  });
});
