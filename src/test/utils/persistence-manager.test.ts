import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PersistenceManager } from '../../lib/utils/persistence-manager';
import { authManager, getUserCases, getCaseConversation } from '../../lib/api';

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
  authManager: {
    isAuthenticated: vi.fn()
  },
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('detectExtensionReload', () => {
    it('should detect reload when explicit reload flag is set', async () => {
      // Mock authenticated user with reload flag set (deterministic signal)
      vi.mocked(authManager.isAuthenticated).mockResolvedValue(true);
      mockBrowser.storage.local.get.mockResolvedValue({
        conversationTitles: { 'case1': 'Title' },
        conversations: {},
        faultmaven_extension_version: '1.0.0',
        faultmaven_reload_detected: true, // Explicit reload flag
        faultmaven_session_id: 'test-ext-id'
      });

      const result = await PersistenceManager.detectExtensionReload();

      expect(result).toBe(true);
      expect(authManager.isAuthenticated).toHaveBeenCalled();
      expect(mockBrowser.storage.local.get).toHaveBeenCalled();
    });

    it('should not detect reload when no deterministic signals present', async () => {
      // Mock authenticated user with no reload flag, matching version, and matching session
      vi.mocked(authManager.isAuthenticated).mockResolvedValue(true);
      mockBrowser.storage.local.get.mockResolvedValue({
        conversationTitles: { 'case1': 'Test Chat' },
        conversations: { 'case1': [{ id: '1', content: 'msg' }] },
        faultmaven_extension_version: '1.0.0', // Matches current version
        faultmaven_session_id: 'test-ext-id', // Matches current session
        faultmaven_last_sync: Date.now()
      });

      const result = await PersistenceManager.detectExtensionReload();

      expect(result).toBe(false);
    });

    it('should detect reload when version mismatch occurs', async () => {
      // Mock version mismatch scenario
      vi.mocked(authManager.isAuthenticated).mockResolvedValue(true);
      mockBrowser.storage.local.get.mockResolvedValue({
        conversationTitles: { 'case1': 'Test Chat' },
        conversations: { 'case1': [] },
        faultmaven_extension_version: '0.9.0', // Different version
        faultmaven_last_sync: Date.now()
      });

      const result = await PersistenceManager.detectExtensionReload();

      expect(result).toBe(true);
    });

    it('should not detect reload when user is not authenticated', async () => {
      // Mock unauthenticated user
      vi.mocked(authManager.isAuthenticated).mockResolvedValue(false);
      mockBrowser.storage.local.get.mockResolvedValue({});

      const result = await PersistenceManager.detectExtensionReload();

      expect(result).toBe(false);
    });
  });

  describe('recoverConversationsFromBackend', () => {
    it('should successfully recover conversations from backend', async () => {
      // Setup mocks for successful recovery
      vi.mocked(authManager.isAuthenticated).mockResolvedValue(true);

      const mockCases = [
        {
          case_id: 'case1',
          owner_id: 'user1',
          organization_id: 'org1',
          title: 'Test Chat 1',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T01:00:00Z',
          status: 'investigating' as const,
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
          status: 'investigating' as const,
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

    it('should handle unauthenticated user gracefully', async () => {
      vi.mocked(authManager.isAuthenticated).mockResolvedValue(false);

      const result = await PersistenceManager.recoverConversationsFromBackend();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('User not authenticated - cannot recover conversations');
      expect(getUserCases).not.toHaveBeenCalled();
    });

    it('should handle empty cases list', async () => {
      vi.mocked(authManager.isAuthenticated).mockResolvedValue(true);
      vi.mocked(getUserCases).mockResolvedValue([]);

      const result = await PersistenceManager.recoverConversationsFromBackend();

      expect(result.success).toBe(true);
      expect(result.recoveredCases).toBe(0);
      expect(result.strategy).toBe('no_recovery_needed');
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(authManager.isAuthenticated).mockResolvedValue(true);
      vi.mocked(getUserCases).mockRejectedValue(new Error('API Error'));

      const result = await PersistenceManager.recoverConversationsFromBackend();

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Recovery failed: API Error');
    });

    it('should handle successful metadata recovery (no conversation fetching)', async () => {
      // New lazy-loading strategy: even if case list fetch succeeds,
      // conversations are NOT fetched - they're lazy-loaded on demand
      vi.mocked(authManager.isAuthenticated).mockResolvedValue(true);

      const mockCases = [
        {
          case_id: 'case1',
          owner_id: 'user1',
          organization_id: 'org1',
          title: 'Working Chat',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T01:00:00Z',
          status: 'investigating' as const,
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
          status: 'investigating' as const,
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

  describe('getCurrentState', () => {
    it('should return current persistence state', async () => {
      const mockStoredData = {
        conversationTitles: { 'case1': 'Test Chat' },
        titleSources: { 'case1': 'backend' },
        conversations: { 'case1': [] },
        faultmaven_last_sync: 1234567890,
        faultmaven_extension_version: '1.0.0'
      };

      mockBrowser.storage.local.get.mockResolvedValue(mockStoredData);

      const result = await PersistenceManager.getCurrentState();

      expect(result).toEqual({
        conversationTitles: { 'case1': 'Test Chat' },
        titleSources: { 'case1': 'backend' },
        conversations: { 'case1': [] },
        lastSyncTimestamp: 1234567890,
        extensionVersion: '1.0.0'
      });
    });

    it('should return empty state when storage is empty', async () => {
      mockBrowser.storage.local.get.mockResolvedValue({});

      const result = await PersistenceManager.getCurrentState();

      expect(result).toEqual({
        conversationTitles: {},
        titleSources: {},
        conversations: {},
        lastSyncTimestamp: 0,
        extensionVersion: 'unknown'
      });
    });
  });

  describe('markSyncComplete', () => {
    it('should update sync timestamp and version', async () => {
      await PersistenceManager.markSyncComplete();

      expect(mockBrowser.storage.local.set).toHaveBeenCalledWith({
        faultmaven_last_sync: expect.any(Number),
        faultmaven_extension_version: '1.0.0',
        faultmaven_session_id: 'test-ext-id'
      });
    });
  });

  describe('clearAllPersistenceData', () => {
    it('should remove all persistence-related storage keys', async () => {
      await PersistenceManager.clearAllPersistenceData();

      expect(mockBrowser.storage.local.remove).toHaveBeenCalledWith([
        'conversationTitles',
        'titleSources',
        'conversations',
        'pendingOperations',
        'idMappings',
        'faultmaven_last_sync',
        'faultmaven_extension_version',
        'faultmaven_recovery_in_progress',
        'faultmaven_reload_detected',
        'faultmaven_session_id'
      ]);
    });
  });
});
