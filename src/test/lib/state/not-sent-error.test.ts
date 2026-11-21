/**
 * `notSentError` is the one helper every "your input was not sent" path goes
 * through (faultmaven#2167). It advises sign-in only for an
 * `AuthenticationError` cause or when the caller asks, and a notice-category
 * cause is passed through as itself.
 */
import { describe, it, expect } from 'vitest';
import { notSentError } from '@faultmaven/copilot-ui/lib/state/unsent-attachments';
import {
  AuthenticationError,
  SessionExpiredError,
  SessionSwitchedError,
  TurnNotSentError,
  UserFacingError,
  type ErrorCategory,
  type RecoveryStrategy,
} from '@faultmaven/copilot-ui/lib/errors/types';

const unsent = { attachments: [{ name: 'app.log', isFile: true }], hasQuery: true };
const SIGN_IN = 'Sign in first, then send again.';
const RESEND = 'Send again to retry.';

describe('notSentError (faultmaven#2167)', () => {
  it('a session being refreshed is not a sign-out: no sign-in advice', () => {
    const shown = notSentError(unsent, 'The case could not be created.', new SessionExpiredError());

    expect(shown).toBeInstanceOf(TurnNotSentError);
    expect(shown.userMessage).toBe(
      'Your message and 1 file (app.log) were not sent. Your session has expired. Your input is still in the message box.',
    );
    expect(shown.userAction).toBe(RESEND);
  });

  it('an ended session advises sign-in', () => {
    const shown = notSentError(unsent, 'The case could not be created.', new AuthenticationError('Authentication required'));
    expect(shown.userAction).toBe(SIGN_IN);
  });

  it('advises sign-in when the caller asks, whatever the cause', () => {
    expect(notSentError(unsent, 'You are signed out.', new SessionExpiredError(), { signIn: true }).userAction).toBe(SIGN_IN);
    expect(notSentError(unsent, 'You are signed out.', undefined, { signIn: true }).userAction).toBe(SIGN_IN);
  });

  it('another account signed in is shown as that notice itself (#350)', () => {
    const cause = new SessionSwitchedError();
    const shown = notSentError(unsent, 'The case could not be created.', cause);
    expect(shown).toBe(cause);
    expect(shown.category).toBe('notice');
  });

  // The rule is the category, not the class: any notice passes through.
  it('any notice-category cause is passed through as itself', () => {
    class StubNotice extends UserFacingError {
      readonly name: string = 'StubNotice';
      readonly userTitle = 'Stub';
      readonly userMessage = 'A notice.';
      readonly userAction = 'Nothing to do.';
      readonly category: ErrorCategory = 'notice';
      readonly recovery: RecoveryStrategy = 'none';
    }
    const cause = new StubNotice('stub');
    expect(notSentError(unsent, 'Something went wrong before it could be sent.', cause)).toBe(cause);
  });

  it('a plain error keeps the resend advice', () => {
    const shown = notSentError(unsent, 'Something went wrong before it could be sent.', new Error('boom'));
    expect(shown).toBeInstanceOf(TurnNotSentError);
    expect(shown.userAction).toBe(RESEND);
  });
});
