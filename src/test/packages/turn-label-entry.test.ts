import { describe, it, expect } from 'vitest';
import {
  displayedTurn,
  investigationTurnFor,
  messageKind,
  predictedInvestigationTurn,
  serverSuppliesInvestigationTurn,
  turnLabelFor,
} from '@faultmaven/copilot-ui/turn-label';

/**
 * The door the Dashboard reaches these rules through.
 *
 * `contract-entry.test.ts` exists because a re-export site silently omitted a
 * new name once already. This is the same hazard on a second door: the rules
 * are consumed by another repository, so dropping one here breaks a build
 * nothing in THIS repo compiles.
 *
 * Asserted against the SOURCE as well as the runtime, because an import that
 * resolves proves the name exists somewhere — not that this module is where
 * the Dashboard is allowed to find it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `process.cwd()`, matching `contract-entry.test.ts` beside it — this repo's
// vitest runs from the root and excludes worktrees, and one path convention
// across the two door tests is worth more than a second one here.
const doorSource = readFileSync(join(process.cwd(), 'packages/copilot-ui/turn-label.ts'), 'utf8');

describe('the turn-label door', () => {
  it.each([
    ['displayedTurn', displayedTurn],
    ['predictedInvestigationTurn', predictedInvestigationTurn],
    ['serverSuppliesInvestigationTurn', serverSuppliesInvestigationTurn],
    ['investigationTurnFor', investigationTurnFor],
    ['messageKind', messageKind],
    ['turnLabelFor', turnLabelFor],
  ])('ships %s', (name, fn) => {
    expect(typeof fn, `${name} is not exported from the door`).toBe('function');
    expect(doorSource).toContain(name);
  });

  it('IMPORTS NOTHING but its own zero-dependency modules', () => {
    // The entire reason this is a root module rather than the package entry:
    // the Dashboard measured an entry import at +200 kB in its signed-out
    // chunk (ADR-016 D3) and permits `contract.ts` only because that costs
    // +196 bytes. A door that reached into the panel, the store or the
    // transport would cost the same as the entry and be worth nothing.
    const specifiers = [...doorSource.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const s of specifiers) {
      expect(s, `${s} is not a zero-dependency state module`).toMatch(
        /^\.\/lib\/state\/(turn-label|message-kind)$/,
      );
    }
  });
});

describe('turnLabelFor — what to PRINT, which is not what the turn IS', () => {
  it('prints the investigation turn when there is one', () => {
    expect(turnLabelFor({ turn_number: 8, investigation_turn: 6 })).toBe(6);
  });

  it('falls back to the message clock when the server did not say', () => {
    expect(turnLabelFor({ turn_number: 8 })).toBe(8);
  });

  it('prints NOTHING at investigation turn 0', () => {
    // An aside before the investigation has had a turn. "Turn 0" names a turn
    // the investigation has not reached — `ChatWindow` already suppressed it
    // inline while the Dashboard's transcript printed it, which is two surfaces
    // disagreeing about one row.
    expect(turnLabelFor({ turn_number: 1, investigation_turn: 0 })).toBeUndefined();
  });

  it('prints nothing for a NOTICE, whatever the row claims', () => {
    // `displayedTurn`'s precondition, made structural. The server stamps a
    // notice with whichever turn was open when its background job finished.
    expect(turnLabelFor({ role: 'system', turn_number: 4, investigation_turn: 3 })).toBeUndefined();
  });

  it('still labels a user or assistant row', () => {
    expect(turnLabelFor({ role: 'user', turn_number: 4, investigation_turn: 3 })).toBe(3);
    expect(turnLabelFor({ role: 'assistant', turn_number: 4, investigation_turn: 3 })).toBe(3);
  });
});
