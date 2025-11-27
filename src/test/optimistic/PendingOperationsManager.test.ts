import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PendingOperationsManager, PendingOperation } from '../../lib/optimistic/PendingOperationsManager';

describe('PendingOperationsManager', () => {
  let manager: PendingOperationsManager;

  beforeEach(() => {
    // Create manager with no auto-cleanup for predictable tests
    manager = new PendingOperationsManager(999999999);
  });

  afterEach(() => {
    manager.destroy();
  });

  const createMockOperation = (overrides?: Partial<PendingOperation>): PendingOperation => ({
    id: 'op_' + Math.random().toString(36).substr(2, 9),
    type: 'create_case',
    status: 'pending',
    optimisticData: { case_id: 'opt_case_123' },
    rollbackFn: vi.fn(),
    createdAt: Date.now(),
    ...overrides
  });

  describe('add', () => {
    it('adds operation to manager', () => {
      const op = createMockOperation();
      manager.add(op);

      expect(manager.get(op.id)).toBe(op);
    });

    it('overwrites existing operation with same ID', () => {
      const op1 = createMockOperation({ id: 'same-id' });
      const op2 = createMockOperation({ id: 'same-id', type: 'submit_query' });

      manager.add(op1);
      manager.add(op2);

      expect(manager.get('same-id')?.type).toBe('submit_query');
    });
  });

  describe('get', () => {
    it('returns operation by ID', () => {
      const op = createMockOperation({ id: 'test-op' });
      manager.add(op);

      expect(manager.get('test-op')).toBe(op);
    });

    it('returns undefined for non-existent ID', () => {
      expect(manager.get('non-existent')).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('returns all operations as record', () => {
      const op1 = createMockOperation({ id: 'op1' });
      const op2 = createMockOperation({ id: 'op2' });

      manager.add(op1);
      manager.add(op2);

      const all = manager.getAll();

      expect(Object.keys(all)).toHaveLength(2);
      expect(all['op1']).toBe(op1);
      expect(all['op2']).toBe(op2);
    });

    it('returns empty record when no operations', () => {
      expect(manager.getAll()).toEqual({});
    });
  });

  describe('complete', () => {
    it('marks operation as completed', () => {
      const op = createMockOperation({ id: 'test-op' });
      manager.add(op);

      manager.complete('test-op');

      const updated = manager.get('test-op');
      expect(updated?.status).toBe('completed');
      expect(updated?.completedAt).toBeDefined();
    });

    it('does nothing for non-existent operation', () => {
      // Should not throw
      manager.complete('non-existent');
    });
  });

  describe('fail', () => {
    it('marks operation as failed with error', () => {
      const op = createMockOperation({ id: 'test-op' });
      manager.add(op);

      manager.fail('test-op', 'Test error message');

      const updated = manager.get('test-op');
      expect(updated?.status).toBe('failed');
      expect(updated?.error).toBe('Test error message');
      expect(updated?.completedAt).toBeDefined();
    });

    it('executes rollback function by default', () => {
      const rollbackFn = vi.fn();
      const op = createMockOperation({ id: 'test-op', rollbackFn });
      manager.add(op);

      manager.fail('test-op', 'Test error');

      expect(rollbackFn).toHaveBeenCalledOnce();
    });

    it('skips rollback when executeRollback is false', () => {
      const rollbackFn = vi.fn();
      const op = createMockOperation({ id: 'test-op', rollbackFn });
      manager.add(op);

      manager.fail('test-op', 'Test error', false);

      expect(rollbackFn).not.toHaveBeenCalled();
    });

    it('handles rollback errors gracefully', () => {
      const rollbackFn = vi.fn().mockImplementation(() => {
        throw new Error('Rollback failed');
      });
      const op = createMockOperation({ id: 'test-op', rollbackFn });
      manager.add(op);

      // Should not throw
      manager.fail('test-op', 'Test error');

      expect(rollbackFn).toHaveBeenCalled();
      expect(manager.get('test-op')?.status).toBe('failed');
    });
  });

  describe('retry', () => {
    it('retries failed operation with retryFn', async () => {
      const retryFn = vi.fn().mockResolvedValue(undefined);
      const op = createMockOperation({
        id: 'test-op',
        status: 'failed',
        retryFn
      });
      manager.add(op);

      await manager.retry('test-op');

      expect(retryFn).toHaveBeenCalledOnce();
      expect(manager.get('test-op')?.status).toBe('completed');
    });

    it('marks as failed if retry throws', async () => {
      const retryFn = vi.fn().mockRejectedValue(new Error('Retry failed'));
      const op = createMockOperation({
        id: 'test-op',
        status: 'failed',
        retryFn
      });
      manager.add(op);

      await manager.retry('test-op');

      expect(manager.get('test-op')?.status).toBe('failed');
      expect(manager.get('test-op')?.error).toBe('Retry failed');
    });

    it('does nothing if no retryFn', async () => {
      const op = createMockOperation({
        id: 'test-op',
        status: 'failed'
      });
      manager.add(op);

      await manager.retry('test-op');

      // Status unchanged
      expect(manager.get('test-op')?.status).toBe('failed');
    });

    it('sets status to pending before retry', async () => {
      let statusDuringRetry: string | undefined;
      const retryFn = vi.fn().mockImplementation(() => {
        statusDuringRetry = manager.get('test-op')?.status;
        return Promise.resolve();
      });

      const op = createMockOperation({
        id: 'test-op',
        status: 'failed',
        retryFn
      });
      manager.add(op);

      await manager.retry('test-op');

      expect(statusDuringRetry).toBe('pending');
    });
  });

  describe('remove', () => {
    it('removes operation from manager', () => {
      const op = createMockOperation({ id: 'test-op' });
      manager.add(op);

      manager.remove('test-op');

      expect(manager.get('test-op')).toBeUndefined();
    });

    it('handles removing non-existent operation', () => {
      // Should not throw
      manager.remove('non-existent');
    });
  });

  describe('getByType', () => {
    it('returns operations filtered by type', () => {
      const caseOp1 = createMockOperation({ id: 'case1', type: 'create_case' });
      const caseOp2 = createMockOperation({ id: 'case2', type: 'create_case' });
      const queryOp = createMockOperation({ id: 'query1', type: 'submit_query' });

      manager.add(caseOp1);
      manager.add(caseOp2);
      manager.add(queryOp);

      const caseOps = manager.getByType('create_case');

      expect(caseOps).toHaveLength(2);
      expect(caseOps.every(op => op.type === 'create_case')).toBe(true);
    });

    it('returns empty array when no matching operations', () => {
      const op = createMockOperation({ type: 'create_case' });
      manager.add(op);

      expect(manager.getByType('submit_query')).toEqual([]);
    });
  });

  describe('getByStatus', () => {
    it('returns operations filtered by status', () => {
      const pending = createMockOperation({ id: 'pending1', status: 'pending' });
      const completed = createMockOperation({ id: 'completed1', status: 'completed' });
      const failed = createMockOperation({ id: 'failed1', status: 'failed' });

      manager.add(pending);
      manager.add(completed);
      manager.add(failed);

      const pendingOps = manager.getByStatus('pending');

      expect(pendingOps).toHaveLength(1);
      expect(pendingOps[0].id).toBe('pending1');
    });
  });

  describe('cleanup', () => {
    it('removes old completed operations', () => {
      const oldCompleted = createMockOperation({
        id: 'old-completed',
        status: 'completed',
        createdAt: Date.now() - 700000 // 11+ minutes old
      });
      const recentCompleted = createMockOperation({
        id: 'recent-completed',
        status: 'completed',
        createdAt: Date.now()
      });

      manager.add(oldCompleted);
      manager.add(recentCompleted);

      manager.cleanup(600000); // 10 minutes max age

      expect(manager.get('old-completed')).toBeUndefined();
      expect(manager.get('recent-completed')).toBeDefined();
    });

    it('removes old failed operations', () => {
      const oldFailed = createMockOperation({
        id: 'old-failed',
        status: 'failed',
        createdAt: Date.now() - 700000
      });

      manager.add(oldFailed);
      manager.cleanup(600000);

      expect(manager.get('old-failed')).toBeUndefined();
    });

    it('keeps pending operations regardless of age', () => {
      const oldPending = createMockOperation({
        id: 'old-pending',
        status: 'pending',
        createdAt: Date.now() - 700000
      });

      manager.add(oldPending);
      manager.cleanup(600000);

      // Pending ops should NOT be removed (they're still active)
      expect(manager.get('old-pending')).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', () => {
      manager.add(createMockOperation({ id: 'p1', status: 'pending' }));
      manager.add(createMockOperation({ id: 'p2', status: 'pending' }));
      manager.add(createMockOperation({ id: 'c1', status: 'completed' }));
      manager.add(createMockOperation({ id: 'f1', status: 'failed' }));

      const stats = manager.getStats();

      expect(stats.total).toBe(4);
      expect(stats.pending).toBe(2);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
    });

    it('calculates oldest pending operation age', () => {
      const oldTime = Date.now() - 5000;
      manager.add(createMockOperation({
        id: 'old-pending',
        status: 'pending',
        createdAt: oldTime
      }));
      manager.add(createMockOperation({
        id: 'new-pending',
        status: 'pending',
        createdAt: Date.now()
      }));

      const stats = manager.getStats();

      expect(stats.oldestPending).toBeGreaterThanOrEqual(5000);
    });

    it('returns undefined oldestPending when no pending ops', () => {
      manager.add(createMockOperation({ status: 'completed' }));

      const stats = manager.getStats();

      expect(stats.oldestPending).toBeUndefined();
    });
  });

  describe('updateOperations', () => {
    it('replaces all operations with provided record', () => {
      // Add initial operations
      manager.add(createMockOperation({ id: 'initial' }));

      // Update with new operations
      const newOps: Record<string, PendingOperation> = {
        'new1': createMockOperation({ id: 'new1' }),
        'new2': createMockOperation({ id: 'new2' })
      };

      manager.updateOperations(newOps);

      expect(manager.get('initial')).toBeUndefined();
      expect(manager.get('new1')).toBeDefined();
      expect(manager.get('new2')).toBeDefined();
    });
  });

  describe('destroy', () => {
    it('stops cleanup timer', () => {
      // Create manager with short cleanup interval
      const shortManager = new PendingOperationsManager(100);

      // Destroy should not throw
      shortManager.destroy();

      // Multiple destroys should not throw
      shortManager.destroy();
    });
  });
});
