import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useConfiguredEndpoint } from '../../shared/ui/hooks/useConfiguredEndpoint';

const b = (global as any).browser;
const origOnChanged = b.storage.onChanged;

describe('useConfiguredEndpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    b.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() };
  });

  afterEach(() => {
    b.storage.onChanged = origOnChanged ?? { addListener: vi.fn(), removeListener: vi.fn() };
  });

  it("'api' returns the configured API base URL", async () => {
    b.storage.local.get.mockResolvedValue({ apiBaseUrl: 'https://api.faultmaven.ai' });
    const { result } = renderHook(() => useConfiguredEndpoint('api'));
    await waitFor(() => expect(result.current).toBe('https://api.faultmaven.ai'));
  });

  it("'dashboard' returns the configured Dashboard URL", async () => {
    b.storage.local.get.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });
    const { result } = renderHook(() => useConfiguredEndpoint('dashboard'));
    await waitFor(() => expect(result.current).toBe('https://app.faultmaven.ai'));
  });

  it('subscribes to storage changes and cleans up on unmount', async () => {
    b.storage.local.get.mockResolvedValue({ apiBaseUrl: 'https://api.faultmaven.ai' });
    const { unmount } = renderHook(() => useConfiguredEndpoint('api'));
    await waitFor(() => expect(b.storage.onChanged.addListener).toHaveBeenCalled());
    unmount();
    expect(b.storage.onChanged.removeListener).toHaveBeenCalled();
  });
});
