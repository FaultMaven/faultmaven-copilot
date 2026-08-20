import { describe, it, expect } from 'vitest';
import { messageKind } from '../../../lib/state/message-kind';

/**
 * The classification, on its own — no store, no render.
 *
 * Two properties, and the second is the one that matters over time: `notice` is
 * the DEFAULT arm, not a special case for `'system'`. A role the backend adds
 * later must not inherit the silence this replaced (#209), and must not be
 * presented as something a participant said.
 */
describe('messageKind', () => {
  it('classifies the two conversational roles', () => {
    expect(messageKind('user')).toBe('user');
    expect(messageKind('assistant')).toBe('assistant');
  });

  it('classifies system — the channel background work reports on — as a notice', () => {
    expect(messageKind('system')).toBe('notice');
  });

  it('defaults anything outside the contract vocabulary to a notice', () => {
    // Not an equality test on 'system': these are what a client sees when the
    // backend starts sending a role it predates, or sends nothing usable.
    for (const role of ['tool', 'developer', 'moderator', '', 'USER', 'Assistant']) {
      expect(messageKind(role), `role ${JSON.stringify(role)}`).toBe('notice');
    }
  });

  it('never returns a conversational kind for an unrecognised role', () => {
    // The safety property behind the case above, stated directly: whatever an
    // unknown role becomes, it must never be attributed to either participant.
    // This is what the Dashboard's binary got wrong in the other direction —
    // everything that was not `assistant` was labelled "You".
    for (const role of ['tool', 'system', 'developer', '', 'USER']) {
      expect(messageKind(role)).not.toBe('user');
      expect(messageKind(role)).not.toBe('assistant');
    }
  });
});
