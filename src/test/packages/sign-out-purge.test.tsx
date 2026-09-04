/**
 * Signing out leaves nothing of the previous user behind.
 *
 * The extension reaches sign-out through a screen that also purges, so the
 * store's reaction to "nobody is signed in" only had to fence the epoch. A host
 * whose sign-out arrives as a NOTIFICATION — a web host's own account menu,
 * another tab, a hard 401 — got no purge at all: the previous user's
 * conversations, titles, pins, active case and session id survived in storage
 * and in memory, and the next user hydrated them and sent the previous user's
 * `X-Session-Id`.
 *
 * Proved through a stub WEB host, which is the shape that was broken.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import CopilotPanel from '@faultmaven/copilot-ui/shared/ui/CopilotPanel';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { setHostStore } from '@faultmaven/copilot-ui/lib/host-store';
import { idMappingManager, pendingOpsManager } from '@faultmaven/copilot-ui/lib/optimistic';
import { createStubHost } from '../support/host';

vi.mock('@faultmaven/copilot-ui/shared/ui/components/ConversationsList', () => ({
  default: () => <div data-testid="conversations-list" />,
}));

/**
 * A web host namespaces what the package asks it to store — the Dashboard's
 * adapter writes `fm.copilot.<key>` — so the assertion is about the NAMESPACE
 * being empty, not about a bare key. The package never sees the prefix.
 */
const NS = 'fm.copilot.';

/** What a signed-in session leaves behind. */
const SEEDED = {
  conversations: { 'case-1': [{ id: 't1', question: 'q', response: 'r' }] },
  conversationTitles: { 'case-1': 'Disk pressure' },
  pinnedCases: ['case-1'],
  faultmaven_current_case: 'case-1',
  sessionId: 'sess-1',
  sessionCreatedAt: 1,
  sessionResumed: false,
  clientId: 'client-1',
  faultmaven_client_id: 'fm-client-1',
};

describe('a null auth state purges the panel', () => {
  let stub: ReturnType<typeof createStubHost>;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubHost(
      Object.fromEntries(Object.entries(SEEDED).map(([k, v]) => [NS + k, v])),
    );
    // Wrap the stub's store so every key it holds is namespaced, as a web host
    // adapter does. `stub.data` is then the host's real key space.
    setHostStore({
      get: async (keys: string[]) => {
        const out = await stub.store.get(keys.map((k) => NS + k));
        return Object.fromEntries(
          Object.entries(out).map(([k, v]) => [k.slice(NS.length), v]),
        );
      },
      set: (items) =>
        stub.store.set(Object.fromEntries(Object.entries(items).map(([k, v]) => [NS + k, v]))),
      remove: (keys: string[]) => stub.store.remove(keys.map((k) => NS + k)),
      subscribe: (keys: string[], onChange) =>
        stub.store.subscribe(keys.map((k) => NS + k), onChange),
    });
    useAppStore.setState({
      initializingCapabilities: false,
      capabilitiesError: null,
      currentUser: { id: 'user-a', username: 'alice', roles: ['user'] },
      conversations: SEEDED.conversations,
      conversationTitles: SEEDED.conversationTitles,
      pinnedCases: new Set(['case-1']),
      activeCaseId: 'case-1',
      hasUnsavedNewChat: false,
    } as never);
    idMappingManager.setState({
      optimisticToReal: new Map([['opt_1', 'case-1']]),
      realToOptimistic: new Map([['case-1', 'opt_1']]),
    });
  });

  afterEach(() => {
    useAppStore.setState({ currentUser: null } as never);
  });

  const signOutThroughTheHost = async () => {
    render(<CopilotPanel host={stub.host} />);
    await waitFor(() => expect(stub.subscribeAuthState).toHaveBeenCalled());
    stub.authStateChanged(null);
  };

  it('empties the persisted namespace', async () => {
    await signOutThroughTheHost();

    await waitFor(() => {
      const surviving = Object.keys(stub.data);
      expect(surviving, `left in the ${NS} namespace: ${surviving.join(', ')}`).toEqual([]);
    });
  });

  it('empties the in-memory store', async () => {
    await signOutThroughTheHost();

    await waitFor(() => {
      const s = useAppStore.getState();
      expect(s.currentUser).toBeNull();
      expect(s.conversations).toEqual({});
      expect(s.conversationTitles).toEqual({});
      expect(s.pinnedCases.size).toBe(0);
      expect(s.activeCaseId).toBeNull();
    });
  });

  it('clears the optimistic singletons, which outlive a session', async () => {
    await signOutThroughTheHost();

    await waitFor(() => {
      const mappings = idMappingManager.getState();
      expect(mappings.optimisticToReal.size).toBe(0);
      expect(mappings.realToOptimistic.size).toBe(0);
      expect(Object.keys(pendingOpsManager.getAll())).toEqual([]);
    });
  });

  // The keep-alive interval is what would otherwise keep pinging with a
  // credential the host has just discarded.
  it('stops the session heartbeat', async () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    await signOutThroughTheHost();

    await waitFor(() => expect(useAppStore.getState().sessionId).toBeNull());
    expect(useAppStore.getState().isSessionInitialized).toBe(false);
    clearIntervalSpy.mockRestore();
  });

  // A queued debounced persist holds a snapshot of the PRE-purge state. Without
  // the guard it lands after the clear and puts it all back.
  it('a persist queued before the sign-out cannot repopulate the purge', async () => {
    const { debouncedPersist } = await import('@faultmaven/copilot-ui/lib/state/store');
    debouncedPersist({
      conversationTitles: SEEDED.conversationTitles,
      titleSources: {},
      conversations: SEEDED.conversations as never,
      pinnedCases: ['case-1'],
    });

    await signOutThroughTheHost();
    await waitFor(() => expect(useAppStore.getState().currentUser).toBeNull());

    debouncedPersist.flush();
    await new Promise((r) => setTimeout(r, 20));

    const surviving = Object.keys(stub.data);
    expect(surviving, `repopulated: ${surviving.join(', ')}`).toEqual([]);
  });

  // …and signing in again must not leave persistence latched off for the life
  // of a page that never reloads.
  it('persistence works again for the next user', async () => {
    await signOutThroughTheHost();
    await waitFor(() => expect(useAppStore.getState().currentUser).toBeNull());

    useAppStore.getState().setSignedInUser({ id: 'user-b', username: 'bob', roles: ['user'] });

    const { debouncedPersist } = await import('@faultmaven/copilot-ui/lib/state/store');
    debouncedPersist({
      conversationTitles: { 'case-b': 'B only' },
      titleSources: {},
      conversations: {} as never,
      pinnedCases: [],
    });
    debouncedPersist.flush();

    await waitFor(() =>
      expect(stub.data[NS + 'conversationTitles']).toEqual({ 'case-b': 'B only' }),
    );
  });
});
