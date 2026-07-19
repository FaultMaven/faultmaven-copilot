import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { mockPM, storageGet, handleCaseSelect, setState, isAuthenticated } = vi.hoisted(() => ({
  mockPM: {
    isRecoveryInProgress: vi.fn().mockResolvedValue(false),
    detectExtensionReload: vi.fn().mockResolvedValue(false),
    recoverConversationsFromBackend: vi.fn(),
    markSyncComplete: vi.fn().mockResolvedValue(undefined)
  },
  storageGet: vi.fn(),
  handleCaseSelect: vi.fn(),
  setState: vi.fn(),
  isAuthenticated: vi.fn().mockResolvedValue(true)
}));

vi.mock('../../lib/utils/persistence-manager', () => ({ PersistenceManager: mockPM }));

vi.mock('../../lib/api', () => ({ authManager: { isAuthenticated } }));

vi.mock('wxt/browser', () => ({
  browser: { storage: { local: { get: (...a: any[]) => storageGet(...a) } } }
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
  }
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
        conversations: { 'case-42': [] }
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
        conversations: { 'case-42': [] }
      });
    });

    renderHook(() => useDataRecovery());

    await waitFor(() => expect(mockPM.markSyncComplete).toHaveBeenCalled());
    expect(setState).not.toHaveBeenCalled();          // store hydrate fenced
    expect(handleCaseSelect).not.toHaveBeenCalled();  // active-case restore fenced
  });
});
