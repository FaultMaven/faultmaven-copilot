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

    it('caps message count per conversation, keeping the most recent', () => {
      const manager = new MemoryManager({ maxMessagesPerConversation: 3, minMessagesToKeep: 1 });
      const many = Array.from({ length: 10 }).map((_, i) =>
        committedMsg({ id: `m${i}`, optimistic: false, timestamp: new Date(1000 + i).toISOString() })
      );
      const result = manager.sanitizeAndCapForPersistence({ 'case-1': many }, undefined);
      expect(result['case-1'].length).toBeLessThanOrEqual(3);
      expect(result['case-1'].map(m => m.id)).toContain('m9');
    });
  });

  describe('cleanupConversation', () => {
    it('should not cleanup if messages are under the limit', () => {
      const manager = new MemoryManager({ maxMessagesPerConversation: 10 });
      const messages: OptimisticConversationItem[] = Array.from({ length: 5 }).map((_, i) => ({
        id: `msg-${i}`,
        role: 'user',
        content: `test ${i}`,
        timestamp: new Date().toISOString(),
        optimistic: false
      }));

      const cleaned = manager.cleanupConversation(messages);
      expect(cleaned.length).toBe(5);
    });

    it('should trim old confirmed messages when over limit', () => {
      const manager = new MemoryManager({ maxMessagesPerConversation: 5, minMessagesToKeep: 2 });
      const messages: OptimisticConversationItem[] = Array.from({ length: 10 }).map((_, i) => ({
        id: `msg-${i}`,
        role: 'user',
        content: `test ${i}`,
        timestamp: new Date(1000 + i).toISOString(),
        optimistic: false
      }));

      const cleaned = manager.cleanupConversation(messages);
      expect(cleaned.length).toBe(5);
      // Should keep the 5 most recent messages (indices 5-9)
      expect(cleaned[0].id).toBe('msg-5');
      expect(cleaned[4].id).toBe('msg-9');
    });

    it('should never delete optimistic messages', () => {
      const manager = new MemoryManager({ maxMessagesPerConversation: 5, minMessagesToKeep: 2 });
      
      // 8 old confirmed, 4 new optimistic
      const messages: OptimisticConversationItem[] = Array.from({ length: 12 }).map((_, i) => ({
        id: `msg-${i}`,
        role: 'user',
        content: `test ${i}`,
        timestamp: new Date(1000 + i).toISOString(),
        optimistic: i >= 8
      }));

      const cleaned = manager.cleanupConversation(messages);
      // Must keep 4 optimistic + at least minMessagesToKeep (2) = 6
      // Let's verify how many it kept (max is 5, but optimistic forces keeping more if needed, though logic says it keeps all optimistic and up to remaining max, but at least min)
      // Confirmed to keep = Math.max(2, 5 - 4) = 2.
      // So it keeps 2 confirmed + 4 optimistic = 6.
      expect(cleaned.length).toBe(6);
      
      const optimisticCount = cleaned.filter((m: OptimisticConversationItem) => m.optimistic).length;
      expect(optimisticCount).toBe(4);
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
