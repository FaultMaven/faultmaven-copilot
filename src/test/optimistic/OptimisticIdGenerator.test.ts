import { describe, it, expect, beforeEach } from 'vitest';
import { OptimisticIdGenerator } from '../../lib/optimistic/OptimisticIdGenerator';

describe('OptimisticIdGenerator', () => {
  beforeEach(() => {
    // Reset counters before each test for predictable results
    OptimisticIdGenerator.resetCounters();
  });

  describe('generateCaseId', () => {
    it('generates unique case IDs with opt_case prefix', () => {
      const id1 = OptimisticIdGenerator.generateCaseId();
      const id2 = OptimisticIdGenerator.generateCaseId();

      expect(id1).toMatch(/^opt_case_\d+_\d+$/);
      expect(id2).toMatch(/^opt_case_\d+_\d+$/);
      expect(id1).not.toBe(id2);
    });

    it('increments counter for each generated ID', () => {
      const id1 = OptimisticIdGenerator.generateCaseId();
      const id2 = OptimisticIdGenerator.generateCaseId();

      // Extract counters from IDs
      const counter1 = parseInt(id1.split('_').pop() || '0');
      const counter2 = parseInt(id2.split('_').pop() || '0');

      expect(counter2).toBe(counter1 + 1);
    });
  });

  describe('generateMessageId', () => {
    it('generates unique message IDs with opt_msg prefix', () => {
      const id1 = OptimisticIdGenerator.generateMessageId();
      const id2 = OptimisticIdGenerator.generateMessageId();

      expect(id1).toMatch(/^opt_msg_\d+_\d+$/);
      expect(id2).toMatch(/^opt_msg_\d+_\d+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('isOptimistic', () => {
    it('returns true for optimistic IDs', () => {
      expect(OptimisticIdGenerator.isOptimistic('opt_case_123_1')).toBe(true);
      expect(OptimisticIdGenerator.isOptimistic('opt_msg_456_2')).toBe(true);
      expect(OptimisticIdGenerator.isOptimistic('opt_custom_789_3')).toBe(true);
    });

    it('returns false for real IDs', () => {
      expect(OptimisticIdGenerator.isOptimistic('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
      expect(OptimisticIdGenerator.isOptimistic('case-123')).toBe(false);
      expect(OptimisticIdGenerator.isOptimistic('msg-456')).toBe(false);
    });
  });

  describe('isOptimisticCase', () => {
    it('returns true for optimistic case IDs', () => {
      expect(OptimisticIdGenerator.isOptimisticCase('opt_case_123_1')).toBe(true);
    });

    it('returns false for optimistic message IDs', () => {
      expect(OptimisticIdGenerator.isOptimisticCase('opt_msg_123_1')).toBe(false);
    });

    it('returns false for real IDs', () => {
      expect(OptimisticIdGenerator.isOptimisticCase('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });
  });

  describe('isOptimisticMessage', () => {
    it('returns true for optimistic message IDs', () => {
      expect(OptimisticIdGenerator.isOptimisticMessage('opt_msg_123_1')).toBe(true);
    });

    it('returns false for optimistic case IDs', () => {
      expect(OptimisticIdGenerator.isOptimisticMessage('opt_case_123_1')).toBe(false);
    });

    it('returns false for real IDs', () => {
      expect(OptimisticIdGenerator.isOptimisticMessage('msg-uuid-123')).toBe(false);
    });
  });

  describe('generate (backward compatibility)', () => {
    it('delegates to generateCaseId for opt_case prefix', () => {
      const id = OptimisticIdGenerator.generate('opt_case');
      expect(id).toMatch(/^opt_case_\d+_\d+$/);
    });

    it('delegates to generateMessageId for opt_msg prefix', () => {
      const id = OptimisticIdGenerator.generate('opt_msg');
      expect(id).toMatch(/^opt_msg_\d+_\d+$/);
    });

    it('generates custom prefixed IDs for unknown prefixes', () => {
      const id = OptimisticIdGenerator.generate('custom_prefix');
      expect(id).toMatch(/^custom_prefix_\d+_\d+$/);
    });

    it('generates unique IDs for custom prefixes', () => {
      const id1 = OptimisticIdGenerator.generate('custom');
      const id2 = OptimisticIdGenerator.generate('custom');
      expect(id1).not.toBe(id2);
    });
  });

  describe('resetCounters', () => {
    it('resets all counters to 0', () => {
      // Generate some IDs
      OptimisticIdGenerator.generateCaseId();
      OptimisticIdGenerator.generateCaseId();
      OptimisticIdGenerator.generateMessageId();

      // Reset
      OptimisticIdGenerator.resetCounters();

      // Counters should start from 1 again
      const caseId = OptimisticIdGenerator.generateCaseId();
      const msgId = OptimisticIdGenerator.generateMessageId();

      expect(caseId).toMatch(/_1$/);
      expect(msgId).toMatch(/_1$/);
    });
  });
});
