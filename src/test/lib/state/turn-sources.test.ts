import { describe, it, expect } from 'vitest';
import { isRestrictedSource, rowsBefore, sourcesToShow } from '@faultmaven/copilot-ui/lib/state/turn-sources';
import type { ConversationItem } from '@faultmaven/copilot-ui/lib/optimistic';
import type { Source } from '@faultmaven/copilot-ui/lib/api';

const kb = (id: string, newThisTurn?: boolean | null): Source => ({
  type: 'knowledge_base',
  content: `Excerpt from ${id}.`,
  confidence: 0.8,
  metadata: { document_id: id, title: id },
  ...(newThisTurn !== undefined ? { new_this_turn: newThisTurn } : {}),
});

const row = (id: string, sources?: Source[]): ConversationItem => ({
  id,
  timestamp: '2026-10-07T00:00:00Z',
  response: 'reply',
  ...(sources !== undefined ? { sources } : {}),
});

// Contract 11.2.0: the server marks what the previous turn's prompt did not carry.
describe('sourcesToShow — a server that says what is new', () => {
  it('keeps the whole list where something in it is new', () => {
    const sources = [kb('a', false), kb('b', true)];
    expect(sourcesToShow(sources)).toBe(sources);
  });

  it('keeps nothing while the standing context is resent unchanged', () => {
    expect(sourcesToShow([kb('a', false), kb('b', false)])).toBeUndefined();
  });

  it('trusts the flag over the conversation', () => {
    // The same runbook was shown earlier; the server says it is new again
    // (a pre-fetch replaced the context and brought it back).
    expect(sourcesToShow([kb('a', true)], [row('r1', [kb('a', true)])])).toEqual([kb('a', true)]);
  });

  it('keeps nothing for a turn whose prompt carried no KB context', () => {
    expect(sourcesToShow([])).toBeUndefined();
    expect(sourcesToShow(null)).toBeUndefined();
    expect(sourcesToShow(undefined)).toBeUndefined();
  });
});

// A self-hosted core older than 11.2.0 sends `sources` with no flag at all.
describe('sourcesToShow — a server older than 11.2.0', () => {
  it('keeps a context the first time it appears', () => {
    expect(sourcesToShow([kb('a')], [row('r1')])).toEqual([kb('a')]);
  });

  it('keeps nothing while the same context is resent', () => {
    expect(sourcesToShow([kb('a')], [row('r1', [kb('a')]), row('r2')])).toBeUndefined();
  });

  it('keeps a context that replaced the one shown', () => {
    expect(sourcesToShow([kb('b')], [row('r1', [kb('a')])])).toEqual([kb('b')]);
  });

  it('reads a null flag as no flag', () => {
    expect(sourcesToShow([kb('a', null)], [row('r1', [kb('a')])])).toBeUndefined();
  });
});

describe('rowsBefore', () => {
  it('is the rows before the given one, or all of them when it is absent', () => {
    const rows = [row('a'), row('b'), row('c')];
    expect(rowsBefore(rows, 'b').map((r) => r.id)).toEqual(['a']);
    expect(rowsBefore(rows, 'zz').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

// Contract 13.1.0 (fm#1920): the redacted shape of a runbook the viewer may not open.
describe('isRestrictedSource', () => {
  const redacted: Source = {
    type: 'knowledge_base', content: '', confidence: null, metadata: { access: 'restricted' }, new_this_turn: true,
  };

  it('is the redacted knowledge-base entry', () => {
    expect(isRestrictedSource(redacted)).toBe(true);
  });

  it('is not an openable runbook', () => {
    expect(isRestrictedSource(kb('doc-1', true))).toBe(false);
  });

  it('is not an entry with no metadata', () => {
    expect(isRestrictedSource({ ...redacted, metadata: null })).toBe(false);
  });

  it('is only ever a knowledge-base entry', () => {
    expect(isRestrictedSource({ ...redacted, type: 'web_search' })).toBe(false);
  });

  it('a context that arrives redacted is still kept where it is new', () => {
    expect(sourcesToShow([redacted])).toEqual([redacted]);
  });
});
