/**
 * #251 — which turn number the UI shows.
 *
 * The backend keeps two counters (API contract 3.5.0): `turn_number` is the
 * message clock and advances on asides too; `investigation_turn` is how far
 * the investigation has got. This module is the one place that chooses between
 * them, so these tests are where the choice is pinned.
 */
import { describe, it, expect } from 'vitest';
import {
  displayedTurn,
  predictedInvestigationTurn
} from '@faultmaven/copilot-ui/lib/state/turn-label';

describe('displayedTurn', () => {
  it('prefers the investigation turn over the message clock', () => {
    // The whole point: turn 8 of the conversation is turn 7 of the
    // investigation because one exchange was an aside (faultmaven#1329).
    expect(displayedTurn({ turn_number: 8, investigation_turn: 7 })).toBe(7);
  });

  it('falls back to the clock when the server did not send one', () => {
    // A server older than contract 3.5.0, and a row this client minted that
    // has not yet been reconciled.
    expect(displayedTurn({ turn_number: 4 })).toBe(4);
    expect(displayedTurn({ turn_number: 4, investigation_turn: null })).toBe(4);
  });

  it('treats investigation turn 0 as an answer, not as absent', () => {
    // An aside before the investigation has had a turn — a bare "hi" on a new
    // case — sits at 0. `||` would fall through to the clock here and print a
    // turn the investigation has not reached; `??` does not. The caller
    // renders no label for 0, which is the honest reading.
    expect(displayedTurn({ turn_number: 1, investigation_turn: 0 })).toBe(0);
  });

  it('is undefined when the row carries neither', () => {
    expect(displayedTurn({})).toBeUndefined();
  });
});

describe('predictedInvestigationTurn', () => {
  it('is the next investigation turn after the highest one held', () => {
    expect(
      predictedInvestigationTurn([
        { turn_number: 7, investigation_turn: 6 },
        { turn_number: 8, investigation_turn: 6 } // an aside: did not advance
      ])
    ).toBe(7);
  });

  it('is undefined when no local row carries an investigation turn', () => {
    // A store persisted before this field existed. Guessing 1 here would put a
    // far bigger jump on screen than the clock fallback it would replace.
    expect(predictedInvestigationTurn([])).toBeUndefined();
    expect(
      predictedInvestigationTurn([{ turn_number: 9 }, { turn_number: 9 }])
    ).toBeUndefined();
  });

  it('ignores rows that carry no investigation turn among rows that do', () => {
    expect(
      predictedInvestigationTurn([
        { turn_number: 1, investigation_turn: 1 },
        { turn_number: 2 },
        { turn_number: 3, investigation_turn: 2 }
      ])
    ).toBe(3);
  });

  it('does not read the message clock', () => {
    // The prediction must not fall back to `turn_number` internally: on a case
    // with asides that is exactly the number being corrected away from.
    expect(
      predictedInvestigationTurn([{ turn_number: 20, investigation_turn: 3 }])
    ).toBe(4);
  });
});
