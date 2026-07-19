import { describe, it, expect } from 'vitest';
import {
  isOptimisticId,
  isRealId,
  sanitizeBackendCases,
  validateStateIntegrity
} from '~lib/utils/data-integrity';
import { UserCase } from '~lib/api/types';

describe('Data Integrity', () => {
  describe('ID validation', () => {
    it('isOptimisticId returns true for opt_*', () => {
      expect(isOptimisticId('opt_123')).toBe(true);
      expect(isOptimisticId('case_123')).toBe(false);
      expect(isOptimisticId('')).toBe(false);
    });

    it('isRealId returns true for non-opt_*', () => {
      expect(isRealId('case_123')).toBe(true);
      expect(isRealId('opt_123')).toBe(false);
    });
  });

  describe('sanitizeBackendCases', () => {
    it('should filter out optimistic IDs from backend data', () => {
      const mixed: UserCase[] = [
        { case_id: 'real-1', title: 'Real 1', state: 'investigating', priority: 'medium', created_at: '', updated_at: '', owner_id: 'test', organization_id: 'test', closure_reason: null, closed_at: null },
        { case_id: 'opt_123', title: 'Fake', state: 'investigating', priority: 'medium', created_at: '', updated_at: '', owner_id: 'test', organization_id: 'test', closure_reason: null, closed_at: null }
      ];
      
      const sanitized = sanitizeBackendCases(mixed);
      expect(sanitized.length).toBe(1);
      expect(sanitized[0].case_id).toBe('real-1');
      expect((sanitized[0] as any).source).toBe('backend');
    });
  });

  describe('validateStateIntegrity', () => {
    it('returns false if optimistic IDs leak into conversations keys', () => {
      const state = {
        conversations: {
          'opt_1': []
        }
      };
      expect(validateStateIntegrity(state)).toBe(false);
    });

    it('returns true for clean state', () => {
      const state = {
        conversations: {
          'real-1': []
        }
      };
      expect(validateStateIntegrity(state)).toBe(true);
    });
  });
});
