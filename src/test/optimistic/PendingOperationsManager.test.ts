import { describe, it, expect, vi } from 'vitest';
import { PendingOperationsManager } from '../../lib/optimistic/PendingOperationsManager';
import type { PendingOperation } from '../../lib/optimistic';

const makeOp = (over: Partial<PendingOperation> = {}): PendingOperation => ({
  id: 'op1',
  type: 'submit_query',
  status: 'pending',
  optimisticData: {},
  rollbackFn: vi.fn(),
  retryFn: vi.fn(),
  createdAt: Date.now(),
  ...over
});

describe('PendingOperationsManager', () => {
  describe('fail', () => {
    it('rolls back by default but NOT when executeRollback is false', () => {
      const m = new PendingOperationsManager();
      const rollbackA = vi.fn();
      m.add(makeOp({ id: 'a', rollbackFn: rollbackA }));
      m.fail('a', 'boom');
      expect(rollbackA).toHaveBeenCalledTimes(1);

      const rollbackB = vi.fn();
      m.add(makeOp({ id: 'b', rollbackFn: rollbackB }));
      m.fail('b', 'boom', false);
      expect(rollbackB).not.toHaveBeenCalled();
      expect(m.getAll()['b']?.status).toBe('failed');
    });
  });

  describe('retry', () => {
    it('does NOT overwrite a re-run that marked itself failed (keeps failed state + retry affordance)', async () => {
      const m = new PendingOperationsManager();
      // The retry function is a re-submission that self-manages this op: here it
      // fails itself (as onFailure does) via fail(id, msg, false).
      const retryFn = vi.fn().mockImplementation(async () => {
        m.fail('a', 'still failing', false);
      });
      m.add(makeOp({ id: 'a', retryFn }));

      await m.retry('a');

      expect(retryFn).toHaveBeenCalledTimes(1);
      expect(m.getAll()['a']?.status).toBe('failed');
    });

    it('marks completed when the re-run succeeds and leaves the op pending', async () => {
      const m = new PendingOperationsManager();
      // A re-run that succeeds without self-managing status leaves it pending;
      // retry() should then complete it.
      const retryFn = vi.fn().mockResolvedValue(undefined);
      m.add(makeOp({ id: 'a', retryFn }));

      await m.retry('a');

      expect(m.getAll()['a']?.status).toBe('completed');
    });

    it('marks failed WITHOUT rolling back when the retry function throws', async () => {
      const m = new PendingOperationsManager();
      const rollback = vi.fn();
      const retryFn = vi.fn().mockRejectedValue(new Error('nope'));
      m.add(makeOp({ id: 'a', retryFn, rollbackFn: rollback }));

      await m.retry('a');

      expect(m.getAll()['a']?.status).toBe('failed');
      expect(rollback).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('drops all tracked operations (logout must not leak them into the next session)', () => {
      const m = new PendingOperationsManager();
      m.add(makeOp({ id: 'a' }));
      m.add(makeOp({ id: 'b' }));
      expect(Object.keys(m.getAll())).toHaveLength(2);

      m.clear();

      expect(Object.keys(m.getAll())).toHaveLength(0);
    });
  });
});
