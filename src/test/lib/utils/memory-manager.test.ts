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

    it('caps a long conversation to the most-recent messages, trimming from the head', () => {
      // The delta-fetch merge (turn-floor + id dedup) makes a most-recent SUFFIX safe:
      // the trimmed head is dropped on re-open, not re-appended as duplicates.
      const manager = new MemoryManager({ maxMessagesPerConversation: 4 });
      // 5 turns, one message each (turn N -> mN).
      const many = Array.from({ length: 10 }).map((_, i) =>
        committedMsg({
          id: `m${i}`, optimistic: false, turn_number: i,
          timestamp: new Date(1000 + i).toISOString()
        })
      );
      const result = manager.sanitizeAndCapForPersistence({ 'case-1': many }, undefined);
      // Head trimmed, tail kept.
      expect(result['case-1'].map(m => m.id)).toEqual(['m6', 'm7', 'm8', 'm9']);
    });

    it('snaps the cap forward to a turn boundary so the oldest kept message starts a turn', () => {
      const manager = new MemoryManager({ maxMessagesPerConversation: 3 });
      // Turns of 2 messages each: turn 0 -> [a0,a1], turn 1 -> [b0,b1], turn 2 -> [c0,c1].
      const msgs = [
        committedMsg({ id: 'a0', turn_number: 0 }),
        committedMsg({ id: 'a1', turn_number: 0 }),
        committedMsg({ id: 'b0', turn_number: 1 }),
        committedMsg({ id: 'b1', turn_number: 1 }),
        committedMsg({ id: 'c0', turn_number: 2 }),
        committedMsg({ id: 'c1', turn_number: 2 })
      ];
      const result = manager.sanitizeAndCapForPersistence({ 'case-1': msgs }, undefined);
      // A raw suffix of 3 would start mid-turn at b1; snap forward to turn 2's start.
      expect(result['case-1'].map(m => m.id)).toEqual(['c0', 'c1']);
    });

    it('does not trim a conversation at or under the cap', () => {
      const manager = new MemoryManager({ maxMessagesPerConversation: 4 });
      const msgs = Array.from({ length: 4 }).map((_, i) =>
        committedMsg({ id: `m${i}`, optimistic: false, turn_number: i })
      );
      const result = manager.sanitizeAndCapForPersistence({ 'case-1': msgs }, undefined);
      expect(result['case-1'].map(m => m.id)).toEqual(['m0', 'm1', 'm2', 'm3']);
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
