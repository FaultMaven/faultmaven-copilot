import { describe, it, expect, beforeEach } from 'vitest';
import { IdMappingManager } from '../../lib/optimistic/IdMappingManager';

describe('IdMappingManager', () => {
  let manager: IdMappingManager;

  beforeEach(() => {
    manager = new IdMappingManager();
  });

  describe('addMapping', () => {
    it('adds case mapping with auto-detected type', () => {
      manager.addMapping('opt_case_123_1', 'real-uuid-123');

      const mapping = manager.getMapping('opt_case_123_1');
      expect(mapping).toBeDefined();
      expect(mapping?.realId).toBe('real-uuid-123');
      expect(mapping?.type).toBe('case');
    });

    it('adds message mapping with auto-detected type', () => {
      manager.addMapping('opt_msg_456_2', 'real-msg-uuid');

      const mapping = manager.getMapping('opt_msg_456_2');
      expect(mapping?.type).toBe('message');
    });

    it('accepts explicit type parameter', () => {
      manager.addMapping('custom_id', 'real-id', 'case');

      const mapping = manager.getMapping('custom_id');
      expect(mapping?.type).toBe('case');
    });

    it('throws error when type cannot be auto-detected', () => {
      expect(() => {
        manager.addMapping('unknown_prefix_123', 'real-id');
      }).toThrow('Cannot auto-detect type');
    });

    it('records creation timestamp', () => {
      const before = Date.now();
      manager.addMapping('opt_case_123_1', 'real-id');
      const after = Date.now();

      const mapping = manager.getMapping('opt_case_123_1');
      expect(mapping?.createdAt).toBeGreaterThanOrEqual(before);
      expect(mapping?.createdAt).toBeLessThanOrEqual(after);
    });
  });

  describe('getRealId', () => {
    it('returns real ID for mapped optimistic ID', () => {
      manager.addMapping('opt_case_123_1', 'real-uuid');

      expect(manager.getRealId('opt_case_123_1')).toBe('real-uuid');
    });

    it('returns undefined for unmapped ID', () => {
      expect(manager.getRealId('unmapped-id')).toBeUndefined();
    });
  });

  describe('getOptimisticId', () => {
    it('returns optimistic ID for real ID (reverse lookup)', () => {
      manager.addMapping('opt_case_123_1', 'real-uuid');

      expect(manager.getOptimisticId('real-uuid')).toBe('opt_case_123_1');
    });

    it('returns undefined for unmapped real ID', () => {
      expect(manager.getOptimisticId('unknown-real-id')).toBeUndefined();
    });
  });

  describe('isMapped', () => {
    it('returns true for mapped ID', () => {
      manager.addMapping('opt_case_123_1', 'real-uuid');

      expect(manager.isMapped('opt_case_123_1')).toBe(true);
    });

    it('returns false for unmapped ID', () => {
      expect(manager.isMapped('unmapped-id')).toBe(false);
    });
  });

  describe('removeMapping', () => {
    it('removes existing mapping and returns true', () => {
      manager.addMapping('opt_case_123_1', 'real-uuid');

      const result = manager.removeMapping('opt_case_123_1');

      expect(result).toBe(true);
      expect(manager.getRealId('opt_case_123_1')).toBeUndefined();
    });

    it('returns false when mapping does not exist', () => {
      const result = manager.removeMapping('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('getAllMappings', () => {
    it('returns all mappings', () => {
      manager.addMapping('opt_case_1', 'real-1');
      manager.addMapping('opt_msg_2', 'real-2');

      const mappings = manager.getAllMappings();

      expect(mappings).toHaveLength(2);
    });

    it('returns empty array when no mappings', () => {
      expect(manager.getAllMappings()).toEqual([]);
    });
  });

  describe('getMappingsByType', () => {
    it('returns only case mappings', () => {
      manager.addMapping('opt_case_1', 'real-1');
      manager.addMapping('opt_case_2', 'real-2');
      manager.addMapping('opt_msg_1', 'real-3');

      const caseMappings = manager.getMappingsByType('case');

      expect(caseMappings).toHaveLength(2);
      expect(caseMappings.every(m => m.type === 'case')).toBe(true);
    });

    it('returns only message mappings', () => {
      manager.addMapping('opt_case_1', 'real-1');
      manager.addMapping('opt_msg_1', 'real-2');
      manager.addMapping('opt_msg_2', 'real-3');

      const msgMappings = manager.getMappingsByType('message');

      expect(msgMappings).toHaveLength(2);
      expect(msgMappings.every(m => m.type === 'message')).toBe(true);
    });
  });

  describe('resolveId', () => {
    it('returns real ID for mapped optimistic ID', () => {
      manager.addMapping('opt_case_123', 'real-uuid');

      expect(manager.resolveId('opt_case_123')).toBe('real-uuid');
    });

    it('returns original optimistic ID if not mapped', () => {
      expect(manager.resolveId('opt_case_unmapped')).toBe('opt_case_unmapped');
    });

    it('returns real ID unchanged', () => {
      expect(manager.resolveId('real-uuid-123')).toBe('real-uuid-123');
    });
  });

  describe('cleanup', () => {
    it('removes old mappings', () => {
      // Add mapping and manually set old timestamp
      manager.addMapping('opt_case_old', 'real-old');
      manager.addMapping('opt_case_new', 'real-new');

      // Directly manipulate for testing (would be old in real usage)
      const mappings = manager.getAllMappings();
      const oldMapping = mappings.find(m => m.optimisticId === 'opt_case_old');
      if (oldMapping) {
        (oldMapping as any).createdAt = Date.now() - 4000000; // Over 1 hour old
      }

      manager.cleanup(3600000); // 1 hour max age

      expect(manager.getRealId('opt_case_old')).toBeUndefined();
      expect(manager.getRealId('opt_case_new')).toBe('real-new');
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', () => {
      manager.addMapping('opt_case_1', 'real-1');
      manager.addMapping('opt_case_2', 'real-2');
      manager.addMapping('opt_msg_1', 'real-3');

      const stats = manager.getStats();

      expect(stats.total).toBe(3);
      expect(stats.cases).toBe(2);
      expect(stats.messages).toBe(1);
    });

    it('calculates oldest mapping age', () => {
      manager.addMapping('opt_case_1', 'real-1');

      const stats = manager.getStats();

      expect(stats.oldestMapping).toBeDefined();
      expect(stats.oldestMapping).toBeGreaterThanOrEqual(0);
    });

    it('returns undefined oldestMapping when empty', () => {
      const stats = manager.getStats();

      expect(stats.oldestMapping).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('removes all mappings', () => {
      manager.addMapping('opt_case_1', 'real-1');
      manager.addMapping('opt_msg_1', 'real-2');

      manager.clear();

      expect(manager.getAllMappings()).toEqual([]);
    });
  });

  describe('state persistence', () => {
    it('getState returns both mapping directions', () => {
      manager.addMapping('opt_case_1', 'real-1');
      manager.addMapping('opt_msg_1', 'real-2');

      const state = manager.getState();

      expect(state.optimisticToReal.get('opt_case_1')).toBe('real-1');
      expect(state.realToOptimistic.get('real-1')).toBe('opt_case_1');
    });

    it('setState restores mappings', () => {
      const state = {
        optimisticToReal: new Map([['opt_case_1', 'real-1']]),
        realToOptimistic: new Map([['real-1', 'opt_case_1']])
      };

      manager.setState(state);

      expect(manager.getRealId('opt_case_1')).toBe('real-1');
    });

    it('setState clears existing mappings first', () => {
      manager.addMapping('opt_case_existing', 'real-existing');

      const state = {
        optimisticToReal: new Map([['opt_case_new', 'real-new']]),
        realToOptimistic: new Map([['real-new', 'opt_case_new']])
      };

      manager.setState(state);

      expect(manager.getRealId('opt_case_existing')).toBeUndefined();
      expect(manager.getRealId('opt_case_new')).toBe('real-new');
    });
  });
});
