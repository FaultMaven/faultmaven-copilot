import { describe, it, expect } from 'vitest';
import { sourcesToShow } from '@faultmaven/copilot-ui/lib/state/turn-sources';
import type { Source } from '@faultmaven/copilot-ui/lib/api';

const kb = (id: string, newThisTurn: boolean | null | undefined): Source => ({
  type: 'knowledge_base',
  content: `Excerpt from ${id}.`,
  confidence: 0.8,
  metadata: { document_id: id, title: id },
  ...(newThisTurn !== undefined ? { new_this_turn: newThisTurn } : {}),
});

// The server marks what the previous turn's prompt did not carry (contract 11.2.0).
describe('sourcesToShow', () => {
  it('keeps the whole list where something in it is new', () => {
    const sources = [kb('a', false), kb('b', true)];
    expect(sourcesToShow(sources)).toBe(sources);
  });

  it('keeps nothing while the standing context is resent unchanged', () => {
    expect(sourcesToShow([kb('a', false), kb('b', false)])).toBeUndefined();
  });

  it('keeps nothing for a turn whose prompt carried no KB context', () => {
    expect(sourcesToShow([])).toBeUndefined();
    expect(sourcesToShow(null)).toBeUndefined();
    expect(sourcesToShow(undefined)).toBeUndefined();
  });

  it('reads an absent or null flag as not new', () => {
    expect(sourcesToShow([kb('a', undefined), kb('b', null)])).toBeUndefined();
  });
});
