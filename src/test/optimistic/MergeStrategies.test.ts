import { describe, it, expect } from 'vitest';
import { MergeStrategies, MergeContext } from '../../lib/optimistic/MergeStrategies';
import { OptimisticConversationItem, ConversationItem } from '../../lib/optimistic/types';

describe('MergeStrategies', () => {
  const baseContext: MergeContext = {
    caseId: 'case-123',
    userId: 'user-456',
    timestamp: Date.now(),
    source: 'optimistic'
  };

  describe('mergeConversations', () => {
    it('merges conversations with no conflicts', () => {
      const optimistic: OptimisticConversationItem[] = [
        { id: 'msg1', question: 'Q1', response: 'R1', timestamp: '2024-01-01T10:00:00Z' }
      ];
      const real: ConversationItem[] = [
        { id: 'msg1', question: 'Q1', response: 'R1', timestamp: '2024-01-01T10:00:00Z' }
      ];

      const result = MergeStrategies.mergeConversations(optimistic, real, baseContext);

      expect(result.merged).toHaveLength(1);
      expect(result.conflicts).toHaveLength(0);
      expect(result.confidence).toBe('high');
      expect(result.requiresUserInput).toBe(false);
    });

    it('includes messages only in optimistic (failed)', () => {
      const optimistic: OptimisticConversationItem[] = [
        { id: 'msg1', question: 'Q1', response: 'Error', failed: true, timestamp: '2024-01-01T10:00:00Z' }
      ];
      const real: ConversationItem[] = [];

      const result = MergeStrategies.mergeConversations(optimistic, real, baseContext);

      expect(result.merged).toHaveLength(1);
      expect(result.merged[0].error).toBe(true);
      expect(result.conflicts.length).toBeGreaterThan(0);
      expect(result.confidence).toBe('medium');
    });

    it('includes messages only in optimistic (pending)', () => {
      const optimistic: OptimisticConversationItem[] = [
        { id: 'msg1', question: 'Q1', optimistic: true, timestamp: '2024-01-01T10:00:00Z' }
      ];
      const real: ConversationItem[] = [];

      const result = MergeStrategies.mergeConversations(optimistic, real, baseContext);

      expect(result.merged).toHaveLength(1);
      expect(result.merged[0].response).toContain('Submitting');
      expect(result.confidence).toBe('medium');
    });

    it('includes messages only in real data', () => {
      const optimistic: OptimisticConversationItem[] = [];
      const real: ConversationItem[] = [
        { id: 'msg1', question: 'Q1', response: 'R1', timestamp: '2024-01-01T10:00:00Z' }
      ];

      const result = MergeStrategies.mergeConversations(optimistic, real, baseContext);

      expect(result.merged).toHaveLength(1);
      expect(result.merged[0].id).toBe('msg1');
    });

    it('sorts merged messages by timestamp', () => {
      const optimistic: OptimisticConversationItem[] = [
        { id: 'msg2', question: 'Q2', response: 'R2', timestamp: '2024-01-01T11:00:00Z' }
      ];
      const real: ConversationItem[] = [
        { id: 'msg1', question: 'Q1', response: 'R1', timestamp: '2024-01-01T10:00:00Z' },
        { id: 'msg3', question: 'Q3', response: 'R3', timestamp: '2024-01-01T12:00:00Z' }
      ];

      const result = MergeStrategies.mergeConversations(optimistic, real, baseContext);

      expect(result.merged[0].id).toBe('msg1');
      expect(result.merged[1].id).toBe('msg2');
      expect(result.merged[2].id).toBe('msg3');
    });

    it('uses originalId for mapping when present', () => {
      const optimistic: OptimisticConversationItem[] = [
        { id: 'opt_msg_123', originalId: 'msg1', question: 'Q1', response: 'Pending...', timestamp: '2024-01-01T10:00:00Z' }
      ];
      const real: ConversationItem[] = [
        { id: 'msg1', question: 'Q1', response: 'Real response', timestamp: '2024-01-01T10:00:00Z' }
      ];

      const result = MergeStrategies.mergeConversations(optimistic, real, baseContext);

      // Should merge by originalId, not by different IDs
      expect(result.merged).toHaveLength(1);
      expect(result.merged[0].response).toBe('Real response'); // Real data wins
    });

    it('requires user input when many conflicts', () => {
      const optimistic: OptimisticConversationItem[] = [
        { id: 'm1', question: 'Different1', failed: true, timestamp: '2024-01-01T10:00:00Z' },
        { id: 'm2', question: 'Different2', failed: true, timestamp: '2024-01-01T10:01:00Z' },
        { id: 'm3', question: 'Different3', failed: true, timestamp: '2024-01-01T10:02:00Z' },
        { id: 'm4', question: 'Different4', failed: true, timestamp: '2024-01-01T10:03:00Z' }
      ];
      const real: ConversationItem[] = [];

      const result = MergeStrategies.mergeConversations(optimistic, real, baseContext);

      expect(result.requiresUserInput).toBe(true);
    });
  });

  describe('mergeTitles', () => {
    it('keeps real title when sources have same precedence', () => {
      const result = MergeStrategies.mergeTitles(
        'Optimistic Title',
        'Real Title',
        {
          ...baseContext,
          optimisticSource: 'backend',
          realSource: 'backend'
        }
      );

      expect(result.merged).toBe('Real Title');
    });

    it('prefers user-set title over system-generated', () => {
      const result = MergeStrategies.mergeTitles(
        'User Custom Title',
        'Case-1028-1',
        {
          ...baseContext,
          optimisticSource: 'user',
          realSource: 'system'
        }
      );

      expect(result.merged).toBe('User Custom Title');
      expect(result.confidence).toBe('high');
    });

    it('prefers system-generated title over backend default', () => {
      const result = MergeStrategies.mergeTitles(
        'Case-1028-2',
        'Untitled',
        {
          ...baseContext,
          optimisticSource: 'system',
          realSource: 'backend'
        }
      );

      expect(result.merged).toBe('Case-1028-2');
    });

    it('records conflict when titles differ', () => {
      const result = MergeStrategies.mergeTitles(
        'Title A',
        'Title B',
        {
          ...baseContext,
          optimisticSource: 'backend',
          realSource: 'backend'
        }
      );

      expect(result.conflicts.length).toBeGreaterThan(0);
    });

    it('does not require user input for title conflicts', () => {
      const result = MergeStrategies.mergeTitles(
        'Title A',
        'Title B',
        {
          ...baseContext,
          optimisticSource: 'user',
          realSource: 'system'
        }
      );

      expect(result.requiresUserInput).toBe(false);
    });
  });

  describe('mergeCaseState', () => {
    it('uses real state as base', () => {
      const optimistic = { status: 'open', title: 'Opt Title' };
      const real = { status: 'in_progress', title: 'Real Title' };

      const result = MergeStrategies.mergeCaseState(optimistic, real, baseContext);

      expect(result.merged.title).toBe('Real Title');
    });

    it('uses higher message_count', () => {
      const optimistic = { message_count: 5 };
      const real = { message_count: 3 };

      const result = MergeStrategies.mergeCaseState(optimistic, real, baseContext);

      expect(result.merged.message_count).toBe(5);
    });

    it('uses more recent updated_at', () => {
      const optimistic = { updated_at: '2024-01-02T12:00:00Z' };
      const real = { updated_at: '2024-01-01T12:00:00Z' };

      const result = MergeStrategies.mergeCaseState(optimistic, real, baseContext);

      expect(result.merged.updated_at).toBe('2024-01-02T12:00:00Z');
    });

    it('preserves optimistic-only fields', () => {
      const optimistic = { status: 'open', customField: 'custom value' };
      const real = { status: 'open' };

      const result = MergeStrategies.mergeCaseState(optimistic, real, baseContext);

      expect(result.merged.customField).toBe('custom value');
    });

    it('records status conflicts as low confidence', () => {
      const optimistic = { status: 'resolved' };
      const real = { status: 'open' };

      const result = MergeStrategies.mergeCaseState(optimistic, real, baseContext);

      expect(result.confidence).toBe('low');
    });

    it('requires user input with many conflicts', () => {
      const optimistic = {
        status: 'resolved',
        updated_at: '2024-01-02T12:00:00Z',
        message_count: 10
      };
      const real = {
        status: 'open',
        updated_at: '2024-01-01T12:00:00Z',
        message_count: 5
      };

      const result = MergeStrategies.mergeCaseState(optimistic, real, baseContext);

      expect(result.conflicts.length).toBeGreaterThan(2);
      expect(result.requiresUserInput).toBe(true);
    });
  });

  describe('mergeArrays', () => {
    it('combines and deduplicates arrays', () => {
      const optimistic = [
        { id: '1', timestamp: '2024-01-01T10:00:00Z' },
        { id: '2', timestamp: '2024-01-01T11:00:00Z' }
      ];
      const real = [
        { id: '2', timestamp: '2024-01-01T11:00:00Z' },
        { id: '3', timestamp: '2024-01-01T12:00:00Z' }
      ];

      const result = MergeStrategies.mergeArrays(optimistic, real, baseContext);

      expect(result.merged).toHaveLength(3);
      expect(result.merged.map(i => i.id)).toEqual(['1', '2', '3']);
    });

    it('sorts by timestamp', () => {
      const optimistic = [
        { id: '3', timestamp: '2024-01-01T12:00:00Z' }
      ];
      const real = [
        { id: '1', timestamp: '2024-01-01T10:00:00Z' }
      ];

      const result = MergeStrategies.mergeArrays(optimistic, real, baseContext);

      expect(result.merged[0].id).toBe('1');
      expect(result.merged[1].id).toBe('3');
    });

    it('records duplicates as conflicts', () => {
      const optimistic = [
        { id: '1', timestamp: '2024-01-01T10:00:00Z' }
      ];
      const real = [
        { id: '1', timestamp: '2024-01-01T10:00:00Z' }
      ];

      const result = MergeStrategies.mergeArrays(optimistic, real, baseContext);

      expect(result.conflicts.some(c => c.includes('Duplicate'))).toBe(true);
      expect(result.confidence).toBe('medium');
    });
  });

  describe('resolveCrossTabConflict', () => {
    it('uses local data when local is newer', () => {
      const localData = { content: 'local' };
      const remoteData = { content: 'remote' };

      const result = MergeStrategies.resolveCrossTabConflict(localData, remoteData, {
        ...baseContext,
        localTimestamp: 2000,
        remoteTimestamp: 1000
      });

      expect(result.merged).toEqual(localData);
    });

    it('uses remote data when remote is newer', () => {
      const localData = { content: 'local' };
      const remoteData = { content: 'remote' };

      const result = MergeStrategies.resolveCrossTabConflict(localData, remoteData, {
        ...baseContext,
        localTimestamp: 1000,
        remoteTimestamp: 2000
      });

      expect(result.merged).toEqual(remoteData);
    });

    it('flags simultaneous changes as low confidence', () => {
      const localData = { content: 'local' };
      const remoteData = { content: 'remote' };

      const result = MergeStrategies.resolveCrossTabConflict(localData, remoteData, {
        ...baseContext,
        localTimestamp: 1000,
        remoteTimestamp: 1000
      });

      expect(result.confidence).toBe('low');
      expect(result.requiresUserInput).toBe(true);
    });

    it('uses cross_tab_resolution strategy', () => {
      const result = MergeStrategies.resolveCrossTabConflict(
        { a: 1 },
        { a: 2 },
        { ...baseContext, localTimestamp: 1000, remoteTimestamp: 2000 }
      );

      expect(result.strategy).toBe('cross_tab_resolution');
    });
  });
});
