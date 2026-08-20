import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { mockPM, storageGet, storageRemove, handleCaseSelect, setState, isAuthenticated } = vi.hoisted(() => ({
  mockPM: {
    isRecoveryInProgress: vi.fn().mockResolvedValue(false),
    detectExtensionReload: vi.fn().mockResolvedValue(false),
    recoverConversationsFromBackend: vi.fn(),
    markSyncComplete: vi.fn().mockResolvedValue(undefined)
  },
  storageGet: vi.fn(),
  storageRemove: vi.fn().mockResolvedValue(undefined),
  handleCaseSelect: vi.fn(),
  setState: vi.fn(),
  isAuthenticated: vi.fn().mockResolvedValue(true)
}));

vi.mock('../../lib/utils/persistence-manager', () => ({ PersistenceManager: mockPM }));

vi.mock('../../lib/api', () => ({ authManager: { isAuthenticated } }));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: (...a: any[]) => storageGet(...a),
        remove: (...a: any[]) => storageRemove(...a)
      }
    }
  }
}));

vi.mock('../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

vi.mock('../../lib/utils/memory-manager', () => ({
  memoryManager: { sanitizeAndCapForPersistence: (c: any) => c }
}));

vi.mock('../../lib/optimistic', () => ({
  idMappingManager: { setState: vi.fn() }
}));

vi.mock('../../lib/state/store', () => ({
  useAppStore: {
    setState: (...a: any[]) => setState(...a),
    getState: () => ({ handleCaseSelect })
  },
  PERSISTED_STATE_KEYS: ['conversationTitles', 'titleSources', 'conversations', 'pinnedCases'],
  CONVERSATION_CACHE_VERSION: 2,
  CONVERSATION_CACHE_VERSION_KEY: 'conversationCacheVersion'
}));

import { useDataRecovery } from '../../shared/ui/hooks/useDataRecovery';

describe('useDataRecovery — active-case restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAuthenticated.mockResolvedValue(true);
    storageGet.mockImplementation((keys: string[]) => {
      if (keys.includes('faultmaven_current_case')) {
        return Promise.resolve({ faultmaven_current_case: 'case-42' });
      }
      // hydration keys
      return Promise.resolve({
        conversationTitles: { 'case-42': 'Prod outage' },
        conversations: { 'case-42': [] },
        conversationCacheVersion: 2
      });
    });
  });

  it('re-selects the persisted active case after a reload', async () => {
    renderHook(() => useDataRecovery());

    await waitFor(() => {
      expect(handleCaseSelect).toHaveBeenCalledWith('case-42');
    });
  });

  it('does not re-select when there is no persisted active case', async () => {
    storageGet.mockImplementation((keys: string[]) => {
      if (keys.includes('faultmaven_current_case')) return Promise.resolve({});
      return Promise.resolve({ conversations: {} });
    });

    renderHook(() => useDataRecovery());

    // Give the effect a tick to run.
    await waitFor(() => expect(mockPM.markSyncComplete).toHaveBeenCalled());
    expect(handleCaseSelect).not.toHaveBeenCalled();
  });

  it('does not restore when unauthenticated (avoids a doomed delta-fetch → 401)', async () => {
    isAuthenticated.mockResolvedValue(false);

    renderHook(() => useDataRecovery());

    await waitFor(() => expect(mockPM.markSyncComplete).toHaveBeenCalled());
    expect(handleCaseSelect).not.toHaveBeenCalled();
  });

  // #143/H3: a logout landing mid-recovery must not let the hydrate re-write the
  // ended session's conversations into the store (which the subscriber would then
  // persist straight back into storage the purge just cleared).
  it('skips the store hydrate + active-case restore when a logout lands during recovery', async () => {
    const { bumpEpoch } = await import('../../lib/state/session-epoch');

    storageGet.mockImplementation((keys: string[]) => {
      if (keys.includes('faultmaven_current_case')) {
        return Promise.resolve({ faultmaven_current_case: 'case-42' });
      }
      // Hydration read (runs just before the hydrate) — simulate a logout here.
      bumpEpoch();
      return Promise.resolve({
        conversationTitles: { 'case-42': 'Prod outage' },
        conversations: { 'case-42': [] },
        conversationCacheVersion: 2
      });
    });

    renderHook(() => useDataRecovery());

    await waitFor(() => expect(mockPM.markSyncComplete).toHaveBeenCalled());
    expect(setState).not.toHaveBeenCalled();          // store hydrate fenced
    expect(handleCaseSelect).not.toHaveBeenCalled();  // active-case restore fenced
  });
});

describe('useDataRecovery — conversation cache schema gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAuthenticated.mockResolvedValue(false); // isolate the hydrate from the restore
  });

  const hydrateWith = (stored: Record<string, unknown>) => {
    storageGet.mockImplementation((keys: string[]) =>
      keys.includes('faultmaven_current_case')
        ? Promise.resolve({})
        : Promise.resolve(stored)
    );
    return renderHook(() => useDataRecovery());
  };

  it('discards a cache written before system rows were admitted (#209)', async () => {
    // The delta fetch offsets by the local committed count, so a cache short by
    // the `role: "system"` rows an older build dropped has an offset pointing
    // PAST them — they can never be re-requested, and the user with the stuck
    // runbook conversion is exactly the one whose case is still cached.
    hydrateWith({
      conversationTitles: { 'case-42': 'Prod outage' },
      conversations: { 'case-42': [{ id: 'm1', optimistic: false }] }
      // no conversationCacheVersion — written by a pre-v2 build
    });

    await waitFor(() => expect(setState).toHaveBeenCalled());

    expect(setState.mock.calls[0][0].conversations).toEqual({});
    expect(storageRemove).toHaveBeenCalledWith([
      'conversations',
      'conversationCacheVersion'
    ]);
    // Everything else survives — this discards a cache, not user data.
    expect(setState.mock.calls[0][0].conversationTitles).toEqual({
      'case-42': 'Prod outage'
    });
  });

  it('discards a cache stamped with a different version', async () => {
    hydrateWith({
      conversations: { 'case-42': [{ id: 'm1', optimistic: false }] },
      conversationCacheVersion: 1
    });

    await waitFor(() => expect(setState).toHaveBeenCalled());
    expect(setState.mock.calls[0][0].conversations).toEqual({});
  });

  it('keeps a cache stamped with the current version', async () => {
    const cached = { 'case-42': [{ id: 'm1', optimistic: false }] };
    hydrateWith({ conversations: cached, conversationCacheVersion: 2 });

    await waitFor(() => expect(setState).toHaveBeenCalled());
    expect(setState.mock.calls[0][0].conversations).toEqual(cached);
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it('does not touch storage when there is no cached conversation map', async () => {
    // A first run has no `conversations` key at all; the gate must not fire and
    // must not write on a cold start.
    hydrateWith({ conversationTitles: { 'case-42': 'Prod outage' } });

    await waitFor(() => expect(setState).toHaveBeenCalled());
    expect(storageRemove).not.toHaveBeenCalled();
  });
});
