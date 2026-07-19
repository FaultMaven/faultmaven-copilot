import { describe, it, expect } from 'vitest';
import { MemoryManager, isCommittedMessage } from '~lib/utils/memory-manager';
import { OptimisticConversationItem } from '~lib/optimistic/types';

const committedMsg = (over: Partial<OptimisticConversationItem>): OptimisticConversationItem => ({
  id: 'm', timestamp: new Date(1000).toISOString(), optimistic: false, ...over
});

describe('MemoryManager', () => {
  describe('isCommittedMessage', () => {
    it('accepts only non-optimistic, non-loading, non-failed, non-error items', () => {
      expect(isCommittedMessage(committedMsg({ optimistic: false }))).toBe(true);
      expect(isCommittedMessage(committedMsg({ optimistic: true }))).toBe(false);
      expect(isCommittedMessage(committedMsg({ optimistic: false, loading: true }))).toBe(false);
      expect(isCommittedMessage(committedMsg({ optimistic: false, failed: true }))).toBe(false);
      expect(isCommittedMessage(committedMsg({ optimistic: false, error: true }))).toBe(false);
    });
  });

  describe('sanitizeAndCapForPersistence', () => {
    it('drops transient messages and keeps committed ones', () => {
      const manager = new MemoryManager();
      const result = manager.sanitizeAndCapForPersistence({
        'case-1': [
          committedMsg({ id: 'ok', optimistic: false }),
          committedMsg({ id: 'opt', optimistic: true }),
          committedMsg({ id: 'spin', optimistic: false, loading: true }),
          committedMsg({ id: 'fail', optimistic: false, failed: true })
        ]
      }, undefined);
      expect(result['case-1'].map(m => m.id)).toEqual(['ok']);
    });

    it('drops conversations that become empty after stripping', () => {
      const manager = new MemoryManager();
      const result = manager.sanitizeAndCapForPersistence({
        'gone': [committedMsg({ optimistic: true, loading: true })],
        'kept': [committedMsg({ id: 'c', optimistic: false })]
      }, undefined);
      expect(result).not.toHaveProperty('gone');
      expect(result).toHaveProperty('kept');
    });

    it('does NOT trim messages within a conversation (would break the delta-fetch offset)', () => {
      // The local copy must remain the backend PREFIX: capping to a suffix would
      // make the offset-based delta fetch re-append overlapping messages as dups.
      const manager = new MemoryManager({ maxMessagesPerConversation: 3, minMessagesToKeep: 1 });
      const many = Array.from({ length: 10 }).map((_, i) =>
        committedMsg({ id: `m${i}`, optimistic: false, timestamp: new Date(1000 + i).toISOString() })
      );
      const result = manager.sanitizeAndCapForPersistence({ 'case-1': many }, undefined);
      // All 10 committed messages preserved, in order.
      expect(result['case-1'].map(m => m.id)).toEqual(
        Array.from({ length: 10 }).map((_, i) => `m${i}`)
      );
    });

    it('caps the NUMBER of conversations while protecting the active case', () => {
      const manager = new MemoryManager({ maxOldConversations: 1 });
      const conversations: Record<string, OptimisticConversationItem[]> = {};
      for (let i = 0; i < 5; i++) {
        conversations[`case-${i}`] = [
          committedMsg({ id: `m${i}`, optimistic: false, timestamp: new Date(1000 + i).toISOString() })
        ];
      }
      const result = manager.sanitizeAndCapForPersistence(conversations, 'case-0');
      // active (case-0) + maxOldConversations (1) most-recent → 2 kept.
      expect(Object.keys(result)).toContain('case-0');
      expect(Object.keys(result).length).toBe(2);
    });
  });

  describe('cleanupConversations', () => {
    it('should preserve active case, failed ops, and optimistic data', () => {
      const manager = new MemoryManager({ maxOldConversations: 3 });
      
      const conversations: Record<string, OptimisticConversationItem[]> = {
        'case-active': [{ id: '1', role: 'user', content: 'test', timestamp: new Date(1000).toISOString(), optimistic: false }],
        'case-failed': [{ id: '2', role: 'user', content: 'test', timestamp: new Date(1000).toISOString(), optimistic: false }],
        'case-optimistic': [{ id: '3', role: 'user', content: 'test', timestamp: new Date(1000).toISOString(), optimistic: true }],
        'case-old-1': [{ id: '4', role: 'user', content: 'test', timestamp: new Date(2000).toISOString(), optimistic: false }],
        'case-old-2': [{ id: '5', role: 'user', content: 'test', timestamp: new Date(1000).toISOString(), optimistic: false }],
      };

      const casesWithFailedOps = new Set(['case-failed']);
      
      const cleaned = manager.cleanupConversations(conversations, 'case-active', casesWithFailedOps);
      
      // Should keep: active, failed, optimistic, PLUS 1 most recent ('case-old-1')
      expect(Object.keys(cleaned)).toContain('case-active');
      expect(Object.keys(cleaned)).toContain('case-failed');
      expect(Object.keys(cleaned)).toContain('case-optimistic');
      expect(Object.keys(cleaned)).toContain('case-old-1');
      expect(Object.keys(cleaned)).not.toContain('case-old-2');
    });
  });
});
