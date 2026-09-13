/**
 * The refresh-token revoke, now that it has moved out of `logoutAuth`.
 *
 * These assertions used to live in `auth.test.ts`, reached through a sign-out.
 * They belong here: `logoutAuth` no longer makes this call — it hands the token
 * to the worker, and the worker's copy is what decides the auth mode and fires
 * the request. Verifying it through the sign-out would now be verifying the
 * fallback path only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetAuthConfig } = vi.hoisted(() => ({ mockGetAuthConfig: vi.fn() }));
vi.mock('../../../extension/auth/auth-config', () => ({ getAuthConfig: mockGetAuthConfig }));

import { setHostEndpoints } from '@faultmaven/copilot-ui/lib/host-endpoints';
import {
  revokeRefreshTokenBestEffort,
  requestRefreshTokenRevoke,
  REVOKE_REFRESH_TOKEN_ACTION,
} from '../../../extension/auth/revoke-refresh-token';

const API = 'https://api.faultmaven.ai';
const REVOKE_URL = `${API}/api/v1/auth/oauth/revoke`;

const oauthMode = () =>
  mockGetAuthConfig.mockResolvedValue({ provider: 'oidc', features: {} as any });
const localMode = () =>
  mockGetAuthConfig.mockResolvedValue({ provider: 'local', features: {} as any });

describe('revokeRefreshTokenBestEffort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as any);
    setHostEndpoints({
      apiUrl: async () => API,
      dashboardUrl: async () => 'https://app.faultmaven.ai',
      subscribe: () => () => {},
    });
  });

  it('OAuth mode: posts the RFC 7009 revocation', async () => {
    oauthMode();

    await revokeRefreshTokenBestEffort('refresh-token');

    expect(fetch).toHaveBeenCalledWith(
      REVOKE_URL,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          token: 'refresh-token',
          token_type_hint: 'refresh_token',
          client_id: 'faultmaven-copilot',
        }),
        signal: expect.anything(),
      }),
    );
  });

  it('local mode: does not fire a doomed request', async () => {
    // /oauth/revoke is not mounted there. getAuthConfig's fallback ladder ends
    // at 'local', so an undeterminable mode also lands here — conservatively.
    localMode();

    await revokeRefreshTokenBestEffort('refresh-token');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('with no token there is nothing to revoke', async () => {
    oauthMode();

    await revokeRefreshTokenBestEffort(null);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('never rejects, whatever the server or the network does', async () => {
    oauthMode();
    (global.fetch as any).mockResolvedValueOnce({ ok: false, status: 400 });
    await expect(revokeRefreshTokenBestEffort('t')).resolves.toBeUndefined();

    (global.fetch as any).mockRejectedValueOnce(new Error('network down'));
    await expect(revokeRefreshTokenBestEffort('t')).resolves.toBeUndefined();

    mockGetAuthConfig.mockRejectedValueOnce(new Error('config unreachable'));
    await expect(revokeRefreshTokenBestEffort('t')).resolves.toBeUndefined();
  });
});

describe('requestRefreshTokenRevoke — the hand-off', () => {
  const b = (global as any).browser;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as any);
    oauthMode();
    b.runtime = {
      ...(b.runtime ?? {}),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };
    setHostEndpoints({
      apiUrl: async () => API,
      dashboardUrl: async () => 'https://app.faultmaven.ai',
      subscribe: () => () => {},
    });
  });

  it('asks the worker, and does not make the call itself', async () => {
    await requestRefreshTokenRevoke('refresh-token');

    expect(b.runtime.sendMessage).toHaveBeenCalledWith({
      action: REVOKE_REFRESH_TOKEN_ACTION,
      refreshToken: 'refresh-token',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falls back to calling here when no worker takes the message', async () => {
    b.runtime.sendMessage.mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.'),
    );

    await requestRefreshTokenRevoke('refresh-token');

    expect(fetch).toHaveBeenCalledWith(REVOKE_URL, expect.anything());
  });

  it('sends nothing when there is no token', async () => {
    await requestRefreshTokenRevoke(null);

    expect(b.runtime.sendMessage).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
