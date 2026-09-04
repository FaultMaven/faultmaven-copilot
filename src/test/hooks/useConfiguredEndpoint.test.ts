import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useConfiguredEndpoint, EndpointKind } from '../../shared/ui/hooks/useConfiguredEndpoint';
import { createStubHost, hostWrapper } from '../support/host';

// Both halves of this hook now come from the host: the VALUE from
// `endpoints.apiUrl` / `endpoints.dashboardUrl`, and the SUBSCRIPTION from
// `endpoints.subscribe`. Nothing here stages `browser.storage.local` — if the
// hook still read it, the global mock in setup.ts would answer and every
// assertion below would be looking at the wrong place and find nothing.
//
// Which storage keys mean "the endpoint changed" is no longer this hook's
// business, and is asserted where it now lives: `extensionEndpoints` in
// src/test/extension/host/endpoints.test.ts.
describe('useConfiguredEndpoint', () => {
  let stub: ReturnType<typeof createStubHost>;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubHost();
  });

  const render = (kind: EndpointKind) =>
    renderHook(() => useConfiguredEndpoint(kind), { wrapper: hostWrapper(stub.host) });

  // Deliberately NOT the Cloud defaults. A call site that fell back to
  // `getApiUrl()`'s own default would answer `https://api.faultmaven.ai` and
  // pass a test that asserted it, having reached no host at all.
  it("'api' asks the host for the API base URL", async () => {
    stub.apiUrl.mockResolvedValue('https://api.host-answered.invalid');
    const { result } = render('api');
    await waitFor(() => expect(result.current).toBe('https://api.host-answered.invalid'));
    expect(stub.dashboardUrl).not.toHaveBeenCalled();
  });

  it("'dashboard' asks the host for the Dashboard URL", async () => {
    stub.dashboardUrl.mockResolvedValue('https://app.host-answered.invalid');
    const { result } = render('dashboard');
    await waitFor(() => expect(result.current).toBe('https://app.host-answered.invalid'));
    expect(stub.apiUrl).not.toHaveBeenCalled();
  });

  it('subscribes through the host endpoints', async () => {
    stub.apiUrl.mockResolvedValue('https://api.host-answered.invalid');
    render('api');

    await waitFor(() => expect(stub.endpoints.subscribe).toHaveBeenCalledWith(expect.any(Function)));
  });

  it('unsubscribes through the host on unmount', async () => {
    stub.apiUrl.mockResolvedValue('https://api.host-answered.invalid');
    const { result, unmount } = render('api');
    await waitFor(() => expect(result.current).toBe('https://api.host-answered.invalid'));

    unmount();
    stub.apiUrl.mockResolvedValue('http://should-not-be-read');
    await act(async () => {
      stub.endpointsChanged();
    });

    expect(stub.apiUrl).toHaveBeenCalledTimes(1);
  });

  it('re-reads the endpoint when the host reports it changed', async () => {
    stub.apiUrl.mockResolvedValue('https://api.host-answered.invalid');
    const { result } = render('api');
    await waitFor(() => expect(result.current).toBe('https://api.host-answered.invalid'));

    stub.apiUrl.mockResolvedValue('http://localhost:8090');
    await act(async () => {
      stub.endpointsChanged();
    });

    await waitFor(() => expect(result.current).toBe('http://localhost:8090'));
  });

  // A host that cannot answer is not a host that hangs: the hook renders an
  // empty string rather than leaving a stale URL on screen.
  it('renders an empty endpoint when the host cannot answer', async () => {
    stub.apiUrl.mockRejectedValue(new Error('no endpoint configured'));
    const { result } = render('api');
    await waitFor(() => expect(stub.apiUrl).toHaveBeenCalled());
    expect(result.current).toBe('');
  });
});
