import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBackendUrl } from '../../shared/ui/hooks/useBackendUrl';

const b = (global as any).browser;
const origOnChanged = b.storage.onChanged;

describe('useBackendUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    b.storage.local.get.mockResolvedValue({ apiBaseUrl: 'https://api.faultmaven.ai' });
    b.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() };
  });

  afterEach(() => {
    // Restore to a valid stub (setup.ts has no onChanged) so the hook's unmount
    // cleanup — which may run after this hook depending on teardown order —
    // still finds removeListener.
    b.storage.onChanged = origOnChanged ?? { addListener: vi.fn(), removeListener: vi.fn() };
  });

  it('returns the configured API backend URL', async () => {
    const { result } = renderHook(() => useBackendUrl());
    await waitFor(() => expect(result.current).toBe('https://api.faultmaven.ai'));
  });

  it('subscribes to storage changes and cleans up on unmount', async () => {
    const { unmount } = renderHook(() => useBackendUrl());
    await waitFor(() => expect(b.storage.onChanged.addListener).toHaveBeenCalled());
    unmount();
    expect(b.storage.onChanged.removeListener).toHaveBeenCalled();
  });
});
