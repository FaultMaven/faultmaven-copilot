import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useConfiguredEndpoint, EndpointKind } from '../../shared/ui/hooks/useConfiguredEndpoint';
import { createStubHost, hostWrapper } from '../support/host';

// The VALUE still comes from config.getApiUrl/getDashboardUrl, which read
// browser.storage.local directly — those live in the transitive closure and are
// converted later. What moved to the host is the SUBSCRIPTION.
const b = (global as any).browser;

describe('useConfiguredEndpoint', () => {
  let stub: ReturnType<typeof createStubHost>;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubHost();
  });

  const render = (kind: EndpointKind) =>
    renderHook(() => useConfiguredEndpoint(kind), { wrapper: hostWrapper(stub.host) });

  it("'api' returns the configured API base URL", async () => {
    b.storage.local.get.mockResolvedValue({ apiBaseUrl: 'https://api.faultmaven.ai' });
    const { result } = render('api');
    await waitFor(() => expect(result.current).toBe('https://api.faultmaven.ai'));
  });

  it("'dashboard' returns the configured Dashboard URL", async () => {
    b.storage.local.get.mockResolvedValue({ dashboardUrl: 'https://app.faultmaven.ai' });
    const { result } = render('dashboard');
    await waitFor(() => expect(result.current).toBe('https://app.faultmaven.ai'));
  });

  // The three below are the host-boundary evidence for this hook. Each asserts
  // on the HOST's store; if the hook still called browser.storage.onChanged the
  // global mock in setup.ts would answer it and none of these would see a thing.

  it('subscribes through the host store, naming every endpoint key', async () => {
    b.storage.local.get.mockResolvedValue({ apiBaseUrl: 'https://api.faultmaven.ai' });
    render('api');

    await waitFor(() => expect(stub.subscribe).toHaveBeenCalled());
    expect(stub.subscribe).toHaveBeenCalledWith(
      // The legacy key too: an install that predates explicit endpoints still
      // answers from it, so a change there still changes this hook's answer.
      ['apiBaseUrl', 'dashboardUrl', 'apiEndpoint'],
      expect.any(Function),
    );
  });

  it('unsubscribes through the host on unmount', async () => {
    b.storage.local.get.mockResolvedValue({ apiBaseUrl: 'https://api.faultmaven.ai' });
    const { unmount } = render('api');

    await waitFor(() => expect(stub.subscribe).toHaveBeenCalled());
    expect(stub.unsubscribe).not.toHaveBeenCalled();
    unmount();
    expect(stub.unsubscribe).toHaveBeenCalled();
  });

  it('re-reads the endpoint when the host reports one of those keys changed', async () => {
    b.storage.local.get.mockResolvedValue({ apiBaseUrl: 'https://api.faultmaven.ai' });
    const { result } = render('api');
    await waitFor(() => expect(result.current).toBe('https://api.faultmaven.ai'));

    b.storage.local.get.mockResolvedValue({ apiBaseUrl: 'http://localhost:8090' });
    await act(async () => {
      stub.emit({ apiBaseUrl: 'http://localhost:8090' });
    });

    await waitFor(() => expect(result.current).toBe('http://localhost:8090'));
  });

  it('ignores a change to a key it did not subscribe to', async () => {
    b.storage.local.get.mockResolvedValue({ apiBaseUrl: 'https://api.faultmaven.ai' });
    const { result } = render('api');
    await waitFor(() => expect(result.current).toBe('https://api.faultmaven.ai'));

    b.storage.local.get.mockResolvedValue({ apiBaseUrl: 'http://should-not-be-read' });
    await act(async () => {
      stub.emit({ someUnrelatedKey: 'x' });
    });

    expect(result.current).toBe('https://api.faultmaven.ai');
  });
});
