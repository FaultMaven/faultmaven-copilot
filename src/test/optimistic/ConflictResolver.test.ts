import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictResolver } from '../../lib/optimistic/ConflictResolver';

describe('ConflictResolver', () => {
  let resolver: ConflictResolver;

  beforeEach(() => {
    resolver = new ConflictResolver();
  });

  describe('detectConflict', () => {
    it('detects no conflict when data matches', () => {
      const result = resolver.detectConflict(
        { id: '1', content: 'test' },
        { id: '1', content: 'test' },
        {
          caseId: 'case-123',
          operationType: 'submit_query',
          pendingOperations: []
        }
      );

      expect(result.hasConflict).toBe(false);
      expect(result.conflictType).toBe('none');
    });

    it('detects ID reconciliation conflict with multiple pending operations', () => {
      const result = resolver.detectConflict(
        { id: 'opt_123' },
        { id: 'real_123' },
        {
          caseId: 'case-123',
          operationType: 'submit_query',
          pendingOperations: [
            { id: 'op1', optimisticData: { caseId: 'case-123' } },
            { id: 'op2', optimisticData: { caseId: 'case-123' } }
          ]
        }
      );

      expect(result.hasConflict).toBe(true);
      expect(result.conflictType).toBe('id_reconciliation');
      expect(result.severity).toBe('medium');
      expect(result.autoResolvable).toBe(true);
    });

    it('detects concurrent operations conflict', () => {
      const result = resolver.detectConflict(
        {},
        {},
        {
          caseId: 'case-123',
          operationType: 'submit_query',
          pendingOperations: [
            { id: 'op1', type: 'update_title', optimisticData: { caseId: 'case-123' } }
          ]
        }
      );

      expect(result.hasConflict).toBe(true);
      expect(result.conflictType).toBe('concurrent_operations');
      expect(result.autoResolvable).toBe(false);
    });

    it('detects data sync conflict with significant array length difference', () => {
      const result = resolver.detectConflict(
        [1, 2, 3, 4, 5], // 5 items
        [1],             // 1 item (4 difference > 2 threshold)
        {
          caseId: 'case-123',
          operationType: 'submit_query',
          pendingOperations: []
        }
      );

      expect(result.hasConflict).toBe(true);
      expect(result.conflictType).toBe('data_sync');
      expect(result.severity).toBe('high');
      expect(result.autoResolvable).toBe(false);
    });

    it('detects data sync conflict with timestamp inconsistency', () => {
      const now = Date.now();
      const fiveMinutesAgo = now - 6 * 60 * 1000; // 6 minutes difference

      const result = resolver.detectConflict(
        { timestamp: new Date(now).toISOString() },
        { timestamp: new Date(fiveMinutesAgo).toISOString() },
        {
          caseId: 'case-123',
          operationType: 'submit_query',
          pendingOperations: []
        }
      );

      expect(result.hasConflict).toBe(true);
      expect(result.conflictType).toBe('data_sync');
    });

    it('includes affected data in result', () => {
      const result = resolver.detectConflict(
        {},
        {},
        {
          caseId: 'case-123',
          operationType: 'submit_query',
          pendingOperations: []
        }
      );

      expect(result.affectedData.caseId).toBe('case-123');
    });
  });

  describe('createBackup', () => {
    it('creates backup with unique ID', () => {
      const conflictInfo = {
        hasConflict: true,
        conflictType: 'data_sync' as const,
        conflictingOperations: [],
        affectedData: { caseId: 'case-123' },
        severity: 'high' as const,
        autoResolvable: false
      };

      const backupId1 = resolver.createBackup({ optimistic: [1, 2], real: [1] }, conflictInfo);
      const backupId2 = resolver.createBackup({ optimistic: [1, 2], real: [1] }, conflictInfo);

      expect(backupId1).toMatch(/^backup_\d+_[a-z0-9]+$/);
      expect(backupId1).not.toBe(backupId2);
    });

    it('limits backups to 10', () => {
      const conflictInfo = {
        hasConflict: true,
        conflictType: 'data_sync' as const,
        conflictingOperations: [],
        affectedData: { caseId: 'case-123' },
        severity: 'high' as const,
        autoResolvable: false
      };

      // Create 12 backups
      for (let i = 0; i < 12; i++) {
        resolver.createBackup({ data: i }, conflictInfo);
      }

      // Check stats (should be limited to 10)
      const stats = resolver.getStats();
      expect(stats.totalBackups).toBeLessThanOrEqual(10);
    });
  });

  describe('getResolutionStrategy', () => {
    it('returns backup_and_retry for ID reconciliation conflicts', () => {
      const conflict = {
        hasConflict: true,
        conflictType: 'id_reconciliation' as const,
        conflictingOperations: [],
        affectedData: {},
        severity: 'medium' as const,
        autoResolvable: true
      };

      const strategy = resolver.getResolutionStrategy(conflict);

      expect(strategy.strategy).toBe('backup_and_retry');
    });

    it('returns user_choice for concurrent operations conflicts', () => {
      const conflict = {
        hasConflict: true,
        conflictType: 'concurrent_operations' as const,
        conflictingOperations: ['op1', 'op2'],
        affectedData: {},
        severity: 'medium' as const,
        autoResolvable: false
      };

      const strategy = resolver.getResolutionStrategy(conflict);

      expect(strategy.strategy).toBe('user_choice');
      expect(strategy.userPrompt).toBeDefined();
    });

    it('returns manual_resolution for data sync conflicts', () => {
      const conflict = {
        hasConflict: true,
        conflictType: 'data_sync' as const,
        conflictingOperations: [],
        affectedData: {},
        severity: 'high' as const,
        autoResolvable: false
      };

      const strategy = resolver.getResolutionStrategy(conflict);

      expect(strategy.strategy).toBe('manual_resolution');
    });

    it('returns latest_wins for unknown conflict types', () => {
      const conflict = {
        hasConflict: false,
        conflictType: 'none' as const,
        conflictingOperations: [],
        affectedData: {},
        severity: 'low' as const,
        autoResolvable: true
      };

      const strategy = resolver.getResolutionStrategy(conflict);

      expect(strategy.strategy).toBe('latest_wins');
    });
  });

  describe('restoreFromBackup', () => {
    it('restores original data from backup', () => {
      const originalData = { messages: [1, 2, 3] };
      const conflictInfo = {
        hasConflict: true,
        conflictType: 'data_sync' as const,
        conflictingOperations: [],
        affectedData: { caseId: 'case-123' },
        severity: 'high' as const,
        autoResolvable: false
      };

      const backupId = resolver.createBackup({ optimistic: originalData }, conflictInfo);
      const restored = resolver.restoreFromBackup(backupId);

      expect(restored).toEqual(originalData);
    });

    it('returns null for non-existent backup', () => {
      const restored = resolver.restoreFromBackup('non-existent-backup');

      expect(restored).toBeNull();
    });
  });

  describe('getBackupsForCase', () => {
    it('returns backups for specific case', () => {
      const conflict1 = {
        hasConflict: true,
        conflictType: 'data_sync' as const,
        conflictingOperations: [],
        affectedData: { caseId: 'case-123' },
        severity: 'high' as const,
        autoResolvable: false
      };
      const conflict2 = {
        hasConflict: true,
        conflictType: 'data_sync' as const,
        conflictingOperations: [],
        affectedData: { caseId: 'case-456' },
        severity: 'high' as const,
        autoResolvable: false
      };

      resolver.createBackup({ data: 1 }, conflict1);
      resolver.createBackup({ data: 2 }, conflict1);
      resolver.createBackup({ data: 3 }, conflict2);

      const case123Backups = resolver.getBackupsForCase('case-123');

      expect(case123Backups).toHaveLength(2);
      expect(case123Backups.every(b => b.caseId === 'case-123')).toBe(true);
    });

    it('returns backups sorted by timestamp (newest first)', () => {
      const conflict = {
        hasConflict: true,
        conflictType: 'data_sync' as const,
        conflictingOperations: [],
        affectedData: { caseId: 'case-123' },
        severity: 'high' as const,
        autoResolvable: false
      };

      resolver.createBackup({ data: 1 }, conflict);
      resolver.createBackup({ data: 2 }, conflict);

      const backups = resolver.getBackupsForCase('case-123');

      expect(backups[0].timestamp).toBeGreaterThanOrEqual(backups[1].timestamp);
    });
  });

  describe('cleanup', () => {
    it('removes old backups', async () => {
      const conflict = {
        hasConflict: true,
        conflictType: 'data_sync' as const,
        conflictingOperations: [],
        affectedData: { caseId: 'case-123' },
        severity: 'high' as const,
        autoResolvable: false
      };

      resolver.createBackup({ data: 'old' }, conflict);

      // Wait a small amount so the backup has some age
      await new Promise(resolve => setTimeout(resolve, 10));

      // Cleanup with very short max age (5ms)
      resolver.cleanup(5);

      const stats = resolver.getStats();
      expect(stats.totalBackups).toBe(0);
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', () => {
      const conflict = {
        hasConflict: true,
        conflictType: 'data_sync' as const,
        conflictingOperations: [],
        affectedData: { caseId: 'case-123' },
        severity: 'high' as const,
        autoResolvable: false
      };

      resolver.createBackup({ data: 1 }, conflict);
      resolver.createBackup({ data: 2 }, conflict);

      const stats = resolver.getStats();

      expect(stats.totalBackups).toBe(2);
      expect(stats.activeConflicts).toBeGreaterThanOrEqual(0);
    });
  });
});
