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

// The act-site reads the token together with its owner; these tests stage
// the token and give every one to the panel's user unless they say otherwise.
const { mockOwner, mockPeek } = vi.hoisted(() => ({
  mockOwner: { userId: 'user-a' as string | null },
  // The stored credential as-is: nothing stored unless a test says otherwise.
  mockPeek: vi.fn(),
}));
vi.mock('../../../extension/auth/token-manager', () => ({
  tokenManager: {
    getValidCredential: async () => {
      const accessToken = await mockGetValidAccessToken();
      return accessToken ? { accessToken, userId: mockOwner.userId } : null;
    },
    peekCredential: () => mockPeek(),
  },
}));
vi.mock('../../../extension/auth/auth-manager', () => ({
  authManager: { clearAllAuthData: mockClearAllAuthData },
}));

import { readSessionAccessToken } from '../../../extension/host/session-credential';
import { SessionEndedError } from '../../../extension/auth/session-ended-error';
import { CredentialUnavailableError, SessionSwitchedError } from '@faultmaven/copilot-ui/lib/errors/types';

describe('readSessionAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClearAllAuthData.mockResolvedValue('ended');
    mockOwner.userId = 'user-a';
    mockPeek.mockResolvedValue(null);
  });

  it('refuses a token that belongs to another user, and tears nothing down (#350)', async () => {
    mockGetValidAccessToken.mockResolvedValue('b-token');
    mockOwner.userId = 'user-b';

    await expect(readSessionAccessToken('user-a')).rejects.toBeInstanceOf(SessionSwitchedError);
    expect(mockClearAllAuthData).not.toHaveBeenCalled();
  });

  it('refuses a token whose owner is unknown to a caller that names a user', async () => {
    mockGetValidAccessToken.mockResolvedValue('anon-token');
    mockOwner.userId = null;

    await expect(readSessionAccessToken('user-a')).rejects.toBeInstanceOf(SessionSwitchedError);
  });

  it('compares nothing for a caller that acts for no particular user', async () => {
    mockGetValidAccessToken.mockResolvedValue('b-token');
    mockOwner.userId = 'user-b';

    expect(await readSessionAccessToken(null)).toBe('b-token');
  });

  it('returns the bearer when there is one', async () => {
    mockGetValidAccessToken.mockResolvedValue('a-token');

    expect(await readSessionAccessToken('user-a')).toBe('a-token');
    expect(mockClearAllAuthData).not.toHaveBeenCalled();
  });

  // No usable token is two states (faultmaven#1460), and neither tears down:
  // that would turn every renewal blip into a logout (#99).
  it('signed out (nothing stored): the plain Error, so the request goes out with no bearer', async () => {
    mockGetValidAccessToken.mockResolvedValue(null);

    const failure = await readSessionAccessToken('user-a').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(CredentialUnavailableError);
    expect(failure).not.toBeInstanceOf(SessionSwitchedError);
    expect(mockClearAllAuthData).not.toHaveBeenCalled();
  });

  // A credential kept through a refresh that failed: not sent at all, so its
  // 401 cannot read as an expired session.
  it.each([
    ['kept for this user', 'user-a', 'user-a', CredentialUnavailableError],
    ['kept, for a caller acting for no user', null, 'user-b', CredentialUnavailableError],
    ["another user's", 'user-a', 'user-b', SessionSwitchedError],
  ] as const)('no usable token, a stored credential %s: refused, nothing torn down', async (_label, forUserId, storedOwner, refusal) => {
    mockGetValidAccessToken.mockResolvedValue(null);
    mockPeek.mockResolvedValue({ accessToken: 'expired-token', userId: storedOwner });

    await expect(readSessionAccessToken(forUserId)).rejects.toBeInstanceOf(refusal);
    expect(mockClearAllAuthData).not.toHaveBeenCalled();
  });

  it('tears down on a session verdict, and still reports it', async () => {
    mockGetValidAccessToken.mockRejectedValue(new SessionEndedError('refresh rejected', 'a-token'));

    await expect(readSessionAccessToken('user-a')).rejects.toThrow(SessionEndedError);
    expect(mockClearAllAuthData).toHaveBeenCalledTimes(1);
    // Judged: the teardown is told which credential the verdict was about.
    expect(mockClearAllAuthData).toHaveBeenCalledWith({ accessToken: 'a-token', userId: null });
  });

  it('answers from the newer session, once, when the teardown stands down (#346)', async () => {
    mockGetValidAccessToken
      .mockRejectedValueOnce(new SessionEndedError('refresh rejected', 'a-token'))
      .mockResolvedValueOnce('b-token');
    mockClearAllAuthData.mockResolvedValueOnce('superseded');

    expect(await readSessionAccessToken('user-a')).toBe('b-token');
  });

  it("does not retry when ANOTHER user's session replaced the judged one", async () => {
    // 'replaced': answering from the newer credential would send a request
    // built for the user whose session ended with someone else's bearer.
    mockGetValidAccessToken.mockRejectedValue(new SessionEndedError('refresh rejected', 'a-token', 'user-a'));
    mockClearAllAuthData.mockResolvedValue('replaced');

    await expect(readSessionAccessToken('user-a')).rejects.toThrow(SessionEndedError);
    expect(mockGetValidAccessToken).toHaveBeenCalledTimes(1);
  });

  it('does not retry a second verdict — that one is about the newer session', async () => {
    mockGetValidAccessToken
      .mockRejectedValueOnce(new SessionEndedError('refresh rejected', 'a-token'))
      .mockRejectedValueOnce(new SessionEndedError('refresh rejected', 'b-token'));
    mockClearAllAuthData.mockResolvedValueOnce('superseded').mockResolvedValueOnce('superseded');

    await expect(readSessionAccessToken('user-a')).rejects.toThrow(SessionEndedError);
    expect(mockGetValidAccessToken).toHaveBeenCalledTimes(2);
  });

  // TokenManager throws nothing but its verdict and a failed storage read, and
  // a failed read is not a read that the session is gone (faultmaven#1460).
  it.each([
    ['the credential', () => mockGetValidAccessToken.mockRejectedValue(new Error('storage unavailable'))],
    ['the stored credential, after no usable token', () => {
      mockGetValidAccessToken.mockResolvedValue(null);
      mockPeek.mockRejectedValue(new Error('storage unavailable'));
    }],
  ])('a failed read of %s: refused, keeping the reason, nothing torn down', async (_label, stage) => {
    stage();

    const failure = await readSessionAccessToken('user-a').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CredentialUnavailableError);
    expect((failure as CredentialUnavailableError).originalError?.message).toBe('storage unavailable');
    expect(mockClearAllAuthData).not.toHaveBeenCalled();
  });
});
