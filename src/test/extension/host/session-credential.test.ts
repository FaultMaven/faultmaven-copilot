/**
 * The act-site: the one place a dead session is acted on.
 *
 * This had no test at all. Both harnesses that model the host carried their own
 * copy of the logic, so reverting the real one changed nothing that was
 * asserted — and the whole design turns on this seam, since TokenManager
 * deliberately only reports.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetValidAccessToken, mockClearAllAuthData } = vi.hoisted(() => ({
  mockGetValidAccessToken: vi.fn(),
  mockClearAllAuthData: vi.fn().mockResolvedValue('ended'),
}));

vi.mock('../../../extension/auth/token-manager', () => ({
  tokenManager: { getValidAccessToken: mockGetValidAccessToken },
}));
vi.mock('../../../extension/auth/auth-manager', () => ({
  authManager: { clearAllAuthData: mockClearAllAuthData },
}));

import { readSessionAccessToken } from '../../../extension/host/session-credential';
import { SessionEndedError } from '../../../extension/auth/session-ended-error';

describe('readSessionAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClearAllAuthData.mockResolvedValue('ended');
  });

  it('returns the bearer when there is one', async () => {
    mockGetValidAccessToken.mockResolvedValue('a-token');

    expect(await readSessionAccessToken()).toBe('a-token');
    expect(mockClearAllAuthData).not.toHaveBeenCalled();
  });

  it('does NOT tear down when there is simply no token right now', async () => {
    // The transient answer. The request goes out header-less and its 401 takes
    // the recoverable session path (#99); tearing down here would turn every
    // renewal blip into a logout, which is the regression the whole
    // transient/definitive split exists to prevent.
    mockGetValidAccessToken.mockResolvedValue(null);

    await expect(readSessionAccessToken()).rejects.toThrow();
    expect(mockClearAllAuthData).not.toHaveBeenCalled();
  });

  it('tears down on a session verdict, and still reports it', async () => {
    mockGetValidAccessToken.mockRejectedValue(new SessionEndedError('refresh rejected', 'a-token'));

    await expect(readSessionAccessToken()).rejects.toThrow(SessionEndedError);
    expect(mockClearAllAuthData).toHaveBeenCalledTimes(1);
    // Judged: the teardown is told which credential the verdict was about.
    expect(mockClearAllAuthData).toHaveBeenCalledWith({ accessToken: 'a-token' });
  });

  it('answers from the newer session, once, when the teardown stands down (#346)', async () => {
    mockGetValidAccessToken
      .mockRejectedValueOnce(new SessionEndedError('refresh rejected', 'a-token'))
      .mockResolvedValueOnce('b-token');
    mockClearAllAuthData.mockResolvedValueOnce('superseded');

    expect(await readSessionAccessToken()).toBe('b-token');
  });

  it('does not retry a second verdict — that one is about the newer session', async () => {
    mockGetValidAccessToken
      .mockRejectedValueOnce(new SessionEndedError('refresh rejected', 'a-token'))
      .mockRejectedValueOnce(new SessionEndedError('refresh rejected', 'b-token'));
    mockClearAllAuthData.mockResolvedValueOnce('superseded').mockResolvedValueOnce('superseded');

    await expect(readSessionAccessToken()).rejects.toThrow(SessionEndedError);
    expect(mockGetValidAccessToken).toHaveBeenCalledTimes(2);
  });

  it('passes an ordinary failure through untouched', async () => {
    mockGetValidAccessToken.mockRejectedValue(new Error('network down'));

    await expect(readSessionAccessToken()).rejects.toThrow('network down');
    expect(mockClearAllAuthData).not.toHaveBeenCalled();
  });
});
