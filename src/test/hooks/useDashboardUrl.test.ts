import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardUrl } from '../../shared/ui/hooks/useDashboardUrl';

const b = (global as any).browser;
const origOnChanged = b.storage.onChanged;

describe('useDashboardUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    b.storage.local.get.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });
    b.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() };
  });

  afterEach(() => {
    b.storage.onChanged = origOnChanged ?? { addListener: vi.fn(), removeListener: vi.fn() };
  });

  it('returns the configured dashboard URL (Options), not the backend-reported one', async () => {
    const { result } = renderHook(() => useDashboardUrl());
    await waitFor(() => expect(result.current).toBe('https://app.faultmaven.ai'));
  });

  it('subscribes to storage changes and cleans up on unmount', async () => {
    const { unmount } = renderHook(() => useDashboardUrl());
    await waitFor(() => expect(b.storage.onChanged.addListener).toHaveBeenCalled());
    unmount();
    expect(b.storage.onChanged.removeListener).toHaveBeenCalled();
  });
});
