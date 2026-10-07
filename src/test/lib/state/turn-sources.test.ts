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

  // A turn whose prompt carried no KB context (a greeting, an aside) answers
  // with [] while the context still stands (contract 11.2.0).
  it('records nothing for an empty list, even after a context was shown', () => {
    const conv = [row('r1', [kb('a')]), row('ai')];
    expect(sourcesForTurn(conv, 'ai', [])).toBeUndefined();
    expect(sourcesForTurn(conv, 'ai', undefined)).toBeUndefined();
  });

  it('does not show the standing context again on the turn after an aside', () => {
    // The two turns as the turn paths run them: the aside's result is stored
    // on its row, then the next turn compares against the conversation.
    const asideSources = sourcesForTurn([row('r1', [kb('a')]), row('aside')], 'aside', []);
    const conv = [row('r1', [kb('a')]), row('aside', asideSources), row('ai')];
    expect(sourcesForTurn(conv, 'ai', [kb('a')])).toBeUndefined();
  });

  it('skips an empty list an earlier rule recorded', () => {
    const conv = [row('r1', [kb('a')]), row('r2', []), row('ai')];
    expect(sourcesForTurn(conv, 'ai', [kb('a')])).toBeUndefined();
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
