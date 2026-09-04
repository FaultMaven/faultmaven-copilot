import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PersistenceManager } from '../../lib/utils/persistence-manager';
import { getUserCases, getCaseConversation } from '../../lib/api';
import { setHostStore } from '../../lib/host-store';

// Hoist mock browser to be accessible inside vi.mock
const { mockBrowser } = vi.hoisted(() => {
  return {
    mockBrowser: {
      storage: {
        local: {
          get: vi.fn(),
          set: vi.fn(),
          remove: vi.fn()
        }
      },
      runtime: {
        getManifest: vi.fn(() => ({ version: '1.0.0' })),
        id: 'test-ext-id'
      }
    }
  };
});

// Mock wxt/browser
vi.mock('wxt/browser', () => ({
  browser: mockBrowser
}));

// Mock API functions
vi.mock('../../lib/api', () => ({
  getUserCases: vi.fn(),
  getCaseConversation: vi.fn()
}));

// Mock browser global
vi.stubGlobal('browser', mockBrowser);

describe('PersistenceManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowser.storage.local.get.mockResolvedValue({});
    mockBrowser.storage.local.set.mockResolvedValue(undefined);
    mockBrowser.storage.local.remove.mockResolvedValue(undefined);
    // Storage reaches this module through the host now. Bound to the same mock,
    // so every assertion below watches the same writes it always did.
    setHostStore({
      get: (keys) => mockBrowser.storage.local.get(keys),
      set: (items) => mockBrowser.storage.local.set(items),
      remove: (keys) => mockBrowser.storage.local.remove(keys),
      subscribe: () => () => {},
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('clearAllPersistenceData', () => {
    it('purges the active-case pointer so it cannot leak across logout', async () => {
      await PersistenceManager.clearAllPersistenceData();

      const removedKeys = mockBrowser.storage.local.remove.mock.calls.flatMap(
        (c: any[]) => (Array.isArray(c[0]) ? c[0] : [c[0]])
      );
      // Regression: faultmaven_current_case was absent from the purge list, so
      // the previous session's active case id survived a logout.
      expect(removedKeys).toContain('faultmaven_current_case');
      expect(removedKeys).toContain('conversations');
      expect(removedKeys).toContain('idMappings');
      // The recovery cooldown timestamp must go too, else a stale value would
      // suppress the next login's recovery, leaving it with an empty case list
      // (#144 — matters when a different user signs in on a shared profile).
      expect(removedKeys).toContain('faultmaven_last_recovery_attempt');
    });

    it('preserves pinnedCases only when asked', async () => {
      await PersistenceManager.clearAllPersistenceData({ preservePinnedCases: true });
      const kept = mockBrowser.storage.local.remove.mock.calls.flatMap(
        (c: any[]) => (Array.isArray(c[0]) ? c[0] : [c[0]])
      );
      expect(kept).not.toContain('pinnedCases');
    });
  });

  describe('recoverConversationsFromBackend', () => {
    it('does not recover placeholder titles into the store (fm#1069)', async () => {
      // Recovery used to copy EVERY backend title into conversationTitles with
      // source 'backend'. Because the store wins in selectCaseTitle, a recovered
      // `Case-YYMMDD-N` pins the placeholder ahead of the real title the server
      // writes later — reintroducing, on the recovery path, exactly the seeding
      // this change removed from the two turn hooks.

      const base = {
        owner_id: 'user1',
        organization_id: 'org1',
        created_at: '2026-08-16T00:00:00Z',
        updated_at: '2026-08-16T01:00:00Z',
        state: 'investigating' as const,
        message_count: 2,
        closure_reason: null,
        closed_at: null
      };

      vi.mocked(getUserCases).mockResolvedValue([
        { ...base, case_id: 'named', title: 'Postgres pool exhaustion' },
        { ...base, case_id: 'placeholder6', title: 'Case-260816-1' },
        { ...base, case_id: 'placeholder4', title: 'Case-1106-1' },
        { ...base, case_id: 'untitled', title: '' }
      ]);

      await PersistenceManager.recoverConversationsFromBackend();

      const saved = mockBrowser.storage.local.set.mock.calls
        .map(([arg]: any[]) => arg)
        .find((arg: any) => arg && 'conversationTitles' in arg);

      expect(saved.conversationTitles).toEqual({ named: 'Postgres pool exhaustion' });
      expect(saved.titleSources).toEqual({ named: 'backend' });
      // The untitled case must not get a synthetic `Chat-<date>` either — that is
      // a value no backend ever held, pinned ahead of one it will.
      expect(Object.keys(saved.conversationTitles)).not.toContain('untitled');
    });

    it('should successfully recover conversations from backend', async () => {
      // Setup mocks for successful recovery

      const mockCases = [
        {
          case_id: 'case1',
          owner_id: 'user1',
          organization_id: 'org1',
          title: 'Test Chat 1',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T01:00:00Z',
          state: 'investigating' as const,
          message_count: 2,
          closure_reason: null,
          closed_at: null
        },
        {
          case_id: 'case2',
          owner_id: 'user1',
          organization_id: 'org1',
          title: 'Test Chat 2',
          created_at: '2023-01-02T00:00:00Z',
          updated_at: '2023-01-02T01:00:00Z',
          state: 'investigating' as const,
          message_count: 1,
          closure_reason: null,
          closed_at: null
        }
      ];

      vi.mocked(getUserCases).mockResolvedValue(mockCases);
      // Note: getCaseConversation is NOT called in new lazy-loading strategy

      const result = await PersistenceManager.recoverConversationsFromBackend();

      expect(result.success).toBe(true);
      expect(result.recoveredCases).toBe(2);
      expect(result.recoveredConversations).toBe(0); // Lazy-loading: conversations not fetched during recovery
      expect(result.strategy).toBe('metadata_only_recovery'); // New strategy
      expect(result.errors).toHaveLength(0);

      // Verify storage was updated with metadata only
      expect(mockBrowser.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationTitles: expect.objectContaining({
            'case1': 'Test Chat 1',
            'case2': 'Test Chat 2'
          }),
          titleSources: expect.objectContaining({
            'case1': 'backend',
            'case2': 'backend'
          }),
          conversations: expect.objectContaining({
            'case1': [], // Empty array - will be lazy-loaded when case is opened
            'case2': []  // Empty array - will be lazy-loaded when case is opened
          })
        })
      );

      // Verify getCaseConversation was NOT called (lazy-loading)
      expect(getCaseConversation).not.toHaveBeenCalled();
    });

    it('should handle empty cases list', async () => {
      vi.mocked(getUserCases).mockResolvedValue([]);

      const result = await PersistenceManager.recoverConversationsFromBackend();

      expect(result.success).toBe(true);
      expect(result.recoveredCases).toBe(0);
      expect(result.strategy).toBe('no_recovery_needed');
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(getUserCases).mockRejectedValue(new Error('API Error'));

      const result = await PersistenceManager.recoverConversationsFromBackend();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Recovery failed: API Error');
    });

    it('should handle successful metadata recovery (no conversation fetching)', async () => {
      // New lazy-loading strategy: even if case list fetch succeeds,
      // conversations are NOT fetched - they're lazy-loaded on demand

      const mockCases = [
        {
          case_id: 'case1',
          owner_id: 'user1',
          organization_id: 'org1',
          title: 'Working Chat',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T01:00:00Z',
          state: 'investigating' as const,
          message_count: 1,
          closure_reason: null,
          closed_at: null
        },
        {
          case_id: 'case2',
          owner_id: 'user1',
          organization_id: 'org1',
          title: 'Another Chat',
          created_at: '2023-01-02T00:00:00Z',
          updated_at: '2023-01-02T01:00:00Z',
          state: 'investigating' as const,
          message_count: 1,
          closure_reason: null,
          closed_at: null
        }
      ];

      vi.mocked(getUserCases).mockResolvedValue(mockCases);
      // Note: getCaseConversation is NOT called in new strategy

      const result = await PersistenceManager.recoverConversationsFromBackend();

      expect(result.success).toBe(true);
      expect(result.recoveredCases).toBe(2); // Both case metadata recovered
      expect(result.recoveredConversations).toBe(0); // No conversations fetched (lazy-loading)
      expect(result.errors).toHaveLength(0); // No errors
      expect(result.strategy).toBe('metadata_only_recovery');

      // Should save titles for both cases with empty conversation arrays
      expect(mockBrowser.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationTitles: expect.objectContaining({
            'case1': 'Working Chat',
            'case2': 'Another Chat'
          }),
          conversations: expect.objectContaining({
            'case1': [], // Empty - lazy-loaded
            'case2': []  // Empty - lazy-loaded
          })
        })
      );

      // Verify getCaseConversation was NOT called
      expect(getCaseConversation).not.toHaveBeenCalled();
    });
  });

  describe('isRecoveryInProgress', () => {
    it('should return true when recovery flag is set', async () => {
      mockBrowser.storage.local.get.mockResolvedValue({
        faultmaven_recovery_in_progress: true
      });

      const result = await PersistenceManager.isRecoveryInProgress();
      expect(result).toBe(true);
    });

    it('should return false when recovery flag is not set', async () => {
      mockBrowser.storage.local.get.mockResolvedValue({});

      const result = await PersistenceManager.isRecoveryInProgress();
      expect(result).toBe(false);
    });
  });

  describe('markSyncComplete', () => {
    // The version and the runtime id used to be stamped here too. They are the
    // HOST's — a web page has neither — and are written by the host that knows
    // them; see the extension-reload suite.
    it('records the sync timestamp, and nothing about the runtime', async () => {
      await PersistenceManager.markSyncComplete();

      expect(mockBrowser.storage.local.set).toHaveBeenCalledWith({
        faultmaven_last_sync: expect.any(Number)
      });
    });
  });

  describe('clearAllPersistenceData', () => {
    it('should remove all persistence-related storage keys by default', async () => {
      await PersistenceManager.clearAllPersistenceData();

      const removedKeys = (mockBrowser.storage.local.remove as any).mock.calls[0][0];
      expect(removedKeys).toEqual(expect.arrayContaining([
        'conversationTitles',
        'titleSources',
        'conversations',
        'pendingOperations',
        'pinnedCases',
        'idMappings',
        'faultmaven_last_sync',
        'faultmaven_extension_version',
        'faultmaven_recovery_in_progress',
        'faultmaven_reload_detected',
        'faultmaven_session_id'
      ]));
    });

    it('should preserve pinnedCases when preservePinnedCases option is set', async () => {
      await PersistenceManager.clearAllPersistenceData({ preservePinnedCases: true });

      const removedKeys = (mockBrowser.storage.local.remove as any).mock.calls[0][0];
      expect(removedKeys).not.toContain('pinnedCases');
      expect(removedKeys).toEqual(expect.arrayContaining([
        'conversationTitles',
        'conversations',
        'idMappings'
      ]));
    });
  });
});
