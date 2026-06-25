import { describe, it, expect } from 'vitest';
import { 
  isOptimisticId, 
  isRealId, 
  sanitizeBackendCases, 
  sanitizeOptimisticCases, 
  mergeOptimisticAndReal,
  validateStateIntegrity
} from '~lib/utils/data-integrity';
import { UserCase } from '~lib/api/types';
import { OptimisticUserCase } from '~lib/optimistic/types';

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

  describe('sanitizeOptimisticCases', () => {
    it('should filter out real IDs from optimistic data', () => {
      const mixed: OptimisticUserCase[] = [
        { case_id: 'opt_1', title: 'Opt 1', state: 'investigating', priority: 'medium', created_at: '', updated_at: '', optimistic: true, closure_reason: null, closed_at: null },
        { case_id: 'real-123', title: 'Fake Opt', state: 'investigating', priority: 'medium', created_at: '', updated_at: '', optimistic: true, closure_reason: null, closed_at: null }
      ];
      
      const sanitized = sanitizeOptimisticCases(mixed);
      expect(sanitized.length).toBe(1);
      expect(sanitized[0].case_id).toBe('opt_1');
    });
  });

  describe('mergeOptimisticAndReal', () => {
    it('gives precedence to real cases if IDs conflict', () => {
      const realCases: UserCase[] = [
        { case_id: 'case-1', title: 'Real 1', state: 'investigating', priority: 'medium', created_at: '2023-01-01', updated_at: '2023-01-01', owner_id: 'test', organization_id: 'test', closure_reason: null, closed_at: null }
      ];
      
      // In practice this conflict means an optimistic case was reconciled but not removed from optimistic array
      const optCases: OptimisticUserCase[] = [
        { case_id: 'case-1', title: 'Opt 1 (Conflict)', state: 'investigating', priority: 'medium', created_at: '2023-01-01', updated_at: '2023-01-01', optimistic: true, closure_reason: null, closed_at: null },
        { case_id: 'opt_2', title: 'Opt 2', state: 'investigating', priority: 'medium', created_at: '2023-01-01', updated_at: '2023-01-01', optimistic: true, closure_reason: null, closed_at: null }
      ];
      
      const result = mergeOptimisticAndReal(realCases, optCases);
      
      expect(result.cases.length).toBe(2);
      // The real case should win
      expect(result.cases.find((c: any) => c.case_id === 'case-1')?.title).toBe('Real 1');
      expect((result.cases.find((c: any) => c.case_id === 'case-1') as any).source).toBe('backend');
      // The non-conflicting optimistic case is included
      expect(result.cases.find((c: any) => c.case_id === 'opt_2')?.title).toBe('Opt 2');
      
      expect(result.violations.length).toBe(0);
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
        },
        optimisticCases: [
          { case_id: 'opt_1', title: 'Opt', state: 'investigating' as any, priority: 'low' as any, created_at: '', updated_at: '', optimistic: true, closure_reason: null, closed_at: null }
        ] as OptimisticUserCase[]
      };
      expect(validateStateIntegrity(state)).toBe(true);
    });
  });
});
