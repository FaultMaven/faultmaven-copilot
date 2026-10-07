import { describe, it, expect } from 'vitest';
import { sourcesForTurn } from '@faultmaven/copilot-ui/lib/state/turn-sources';
import type { ConversationItem } from '@faultmaven/copilot-ui/lib/optimistic';
import type { Source } from '@faultmaven/copilot-ui/lib/api';

const kb = (id: string): Source => ({
  type: 'knowledge_base',
  content: `Excerpt from ${id}.`,
  confidence: 0.8,
  metadata: { document_id: id, title: id },
});

const row = (id: string, sources?: Source[]): ConversationItem => ({
  id,
  timestamp: '2026-10-07T00:00:00Z',
  response: 'reply',
  ...(sources !== undefined ? { sources } : {}),
});

describe('sourcesForTurn', () => {
  it('records a context the first time it appears', () => {
    expect(sourcesForTurn([row('ai')], 'ai', [kb('a')])).toEqual([kb('a')]);
  });

  it('records nothing while the backend resends the same context', () => {
    const conv = [row('r1', [kb('a')]), row('r2'), row('ai')];
    expect(sourcesForTurn(conv, 'ai', [kb('a')])).toBeUndefined();
  });

  it('records the new context when a pre-fetch replaces it', () => {
    const conv = [row('r1', [kb('a')]), row('ai')];
    expect(sourcesForTurn(conv, 'ai', [kb('b')])).toEqual([kb('b')]);
  });

  it('records an empty list when a context shown earlier is gone', () => {
    const conv = [row('r1', [kb('a')]), row('ai')];
    expect(sourcesForTurn(conv, 'ai', [])).toEqual([]);
    expect(sourcesForTurn(conv, 'ai', undefined)).toEqual([]);
  });

  it('records nothing when there was no context and still is none', () => {
    expect(sourcesForTurn([row('r1'), row('ai')], 'ai', [])).toBeUndefined();
  });

  it('compares only against rows before the assistant row', () => {
    // A retried turn keeps its id; a row after it must not count as earlier.
    const conv = [row('ai'), row('later', [kb('a')])];
    expect(sourcesForTurn(conv, 'ai', [kb('a')])).toEqual([kb('a')]);
  });
});
