import { describe, it, expect, vi, beforeEach } from 'vitest';
import { browser } from 'wxt/browser';
import { enforceUserDataScope } from '../../../lib/auth/user-scope';
import { PersistenceManager } from '../../../lib/utils/persistence-manager';
import { clientSessionManager } from '../../../lib/session/client-session-manager';

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined)
      }
    }
  }
}));

vi.mock('../../../lib/utils/persistence-manager', () => ({
  PersistenceManager: { clearAllPersistenceData: vi.fn().mockResolvedValue(undefined) }
}));

vi.mock('../../../lib/session/client-session-manager', () => ({
  clientSessionManager: { clearClientId: vi.fn().mockResolvedValue(undefined) }
}));

vi.mock('../../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

const DATA_OWNER_KEY = 'faultmaven_data_owner_id';
const get = browser.storage.local.get as unknown as ReturnType<typeof vi.fn>;
const set = browser.storage.local.set as unknown as ReturnType<typeof vi.fn>;
const remove = browser.storage.local.remove as unknown as ReturnType<typeof vi.fn>;
const clearAll = PersistenceManager.clearAllPersistenceData as unknown as ReturnType<typeof vi.fn>;
const clearClientId = clientSessionManager.clearClientId as unknown as ReturnType<typeof vi.fn>;

describe('enforceUserDataScope (#144 user-isolation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({});
  });

  it('records ownership without purging on a fresh profile (no owner, no residue)', async () => {
    get.mockResolvedValue({}); // no DATA_OWNER_KEY, no conversations/current_case

    const purged = await enforceUserDataScope('userA');

    expect(purged).toBe(false);
    expect(clearAll).not.toHaveBeenCalled();
    expect(clearClientId).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith({ [DATA_OWNER_KEY]: 'userA' });
  });

  it('purges unowned residue (data present but no recorded owner) then re-owns', async () => {
    // Session established before this scoping shipped: conversations at rest with
    // no owner key. Provenance can't be verified, so purge to be safe.
    get.mockResolvedValue({ conversations: { caseA: [{ id: '1' }] } });

    const purged = await enforceUserDataScope('userA');

    expect(purged).toBe(true);
    expect(clearAll).toHaveBeenCalledTimes(1);
    expect(clearClientId).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ [DATA_OWNER_KEY]: 'userA' });
  });

  it('purges unowned residue when only the active-case pointer is present', async () => {
    get.mockResolvedValue({ faultmaven_current_case: 'caseA' });

    const purged = await enforceUserDataScope('userA');

    expect(purged).toBe(true);
    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  it('does not purge for an empty conversations map with no owner', async () => {
    get.mockResolvedValue({ conversations: {} });

    const purged = await enforceUserDataScope('userA');

    expect(purged).toBe(false);
    expect(clearAll).not.toHaveBeenCalled();
  });

  it('does not purge when the same user logs in again', async () => {
    get.mockResolvedValue({ [DATA_OWNER_KEY]: 'userA' });

    const purged = await enforceUserDataScope('userA');

    expect(purged).toBe(false);
    expect(clearAll).not.toHaveBeenCalled();
    expect(clearClientId).not.toHaveBeenCalled();
    // Ownership is (idempotently) re-recorded.
    expect(set).toHaveBeenCalledWith({ [DATA_OWNER_KEY]: 'userA' });
  });

  it('purges prior user data and re-owns storage on identity change', async () => {
    get.mockResolvedValue({ [DATA_OWNER_KEY]: 'userA' });

    const purged = await enforceUserDataScope('userB');

    expect(purged).toBe(true);
    // Conversations / titles / case pointer / optimistic state / pins.
    expect(clearAll).toHaveBeenCalledTimes(1);
    // Backend-session pointer: in-memory client id + the storage keys.
    expect(clearClientId).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(
      expect.arrayContaining(['sessionId', 'sessionCreatedAt', 'sessionResumed', 'clientId'])
    );
    // New owner recorded.
    expect(set).toHaveBeenCalledWith({ [DATA_OWNER_KEY]: 'userB' });
  });

  it('never preserves pins on identity change (clearAllPersistenceData called with no options)', async () => {
    get.mockResolvedValue({ [DATA_OWNER_KEY]: 'userA' });

    await enforceUserDataScope('userB');

    // No { preservePinnedCases: true } — the prior user's pinned case ids must go.
    expect(clearAll).toHaveBeenCalledWith();
  });

  it('skips entirely when called without a user id', async () => {
    const purged = await enforceUserDataScope(undefined);

    expect(purged).toBe(false);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(clearAll).not.toHaveBeenCalled();
  });

  it('does not record an empty owner (would corrupt the next comparison)', async () => {
    await enforceUserDataScope('');

    expect(set).not.toHaveBeenCalled();
  });
});
