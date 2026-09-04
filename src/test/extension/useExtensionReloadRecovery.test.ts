/**
 * The recovery half of persistence, where it now lives — and in the order it
 * has to run in.
 *
 * Recovery WRITES host storage and the shared hydration hook READS it. They
 * used to be one effect, which is what kept them in order; splitting the
 * extension's half out only stays correct because this runs before the panel
 * mounts. These assertions are what that rests on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { mockPM, detectExtensionReload, clearReloadFlag, stampRuntimeIdentity } = vi.hoisted(() => ({
  mockPM: {
    isRecoveryInProgress: vi.fn().mockResolvedValue(false),
    recoverConversationsFromBackend: vi.fn(),
  },
  detectExtensionReload: vi.fn(),
  clearReloadFlag: vi.fn().mockResolvedValue(undefined),
  stampRuntimeIdentity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/utils/persistence-manager', () => ({ PersistenceManager: mockPM }));
vi.mock('../../extension/extension-reload', () => ({
  detectExtensionReload,
  clearReloadFlag,
  stampRuntimeIdentity,
  markReloadDetected: vi.fn(),
}));

import { useExtensionReloadRecovery } from '../../extension/useExtensionReloadRecovery';

const recovered = { success: true, recoveredCases: 3, recoveredConversations: 0, errors: [], strategy: 'metadata_only_recovery' as const };

describe('useExtensionReloadRecovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPM.isRecoveryInProgress.mockResolvedValue(false);
    detectExtensionReload.mockResolvedValue(false);
    mockPM.recoverConversationsFromBackend.mockResolvedValue(recovered);
  });

  // Recovery talks to the backend. Without a session there is no credential to
  // talk with, and firing anyway is a doomed request on every launch.
  it('does nothing at all before there is a session', async () => {
    renderHook(() => useExtensionReloadRecovery(false));

    await new Promise((r) => setTimeout(r, 0));
    expect(detectExtensionReload).not.toHaveBeenCalled();
    expect(stampRuntimeIdentity).not.toHaveBeenCalled();
  });

  it('recovers when a reload is detected, then clears the flag', async () => {
    detectExtensionReload.mockResolvedValue(true);

    const { result } = renderHook(() => useExtensionReloadRecovery(true));

    await waitFor(() => expect(mockPM.recoverConversationsFromBackend).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(clearReloadFlag).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('does not recover when no reload is detected', async () => {
    const { result } = renderHook(() => useExtensionReloadRecovery(true));

    await waitFor(() => expect(stampRuntimeIdentity).toHaveBeenCalled());
    expect(mockPM.recoverConversationsFromBackend).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });

  // The stamp is what makes the NEXT load not look like a reload. Written even
  // when nothing was recovered: a detection that fired on a version bump would
  // otherwise fire again on every launch for the life of the install.
  it('records the runtime identity even when nothing was recovered', async () => {
    await waitFor(async () => {
      renderHook(() => useExtensionReloadRecovery(true));
    });

    await waitFor(() => expect(stampRuntimeIdentity).toHaveBeenCalled());
  });

  it('records the runtime identity even when recovery FAILED', async () => {
    detectExtensionReload.mockResolvedValue(true);
    mockPM.recoverConversationsFromBackend.mockRejectedValue(new Error('offline'));

    renderHook(() => useExtensionReloadRecovery(true));

    await waitFor(() => expect(stampRuntimeIdentity).toHaveBeenCalled());
  });

  // Another context is already doing it. Two panels recovering at once would
  // both fetch the case list and both write it.
  it('does not start a second recovery while one is in progress', async () => {
    mockPM.isRecoveryInProgress.mockResolvedValue(true);
    detectExtensionReload.mockResolvedValue(true);

    renderHook(() => useExtensionReloadRecovery(true));

    await waitFor(() => expect(stampRuntimeIdentity).toHaveBeenCalled());
    expect(detectExtensionReload).not.toHaveBeenCalled();
    expect(mockPM.recoverConversationsFromBackend).not.toHaveBeenCalled();
  });
});
