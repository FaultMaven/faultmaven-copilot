import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthScreen } from '../../extension/components/AuthScreen';

/**
 * The panel's sign-in screen (copilot#185).
 *
 * `isAuthenticating` had exactly one exit once the authorization tab opened:
 * an `auth_state_changed` broadcast. Anything that ended the flow without one —
 * the dashboard consent page erroring, the user closing the tab or denying, a
 * dropped network — left the panel spinning "Authenticating..." indefinitely
 * with the button disabled and no way back but reloading it.
 *
 * The background's 5-minute pending-flow deadline does not cover this: it is
 * evaluated inside the tab-update handler, so a tab that stops navigating never
 * reaches it, and it notifies the panel of nothing when it does.
 */

const mockSendMessage = vi.fn();
const listeners: Array<(m: unknown) => void> = [];

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: (...args: unknown[]) => mockSendMessage(...args),
      onMessage: {
        addListener: (fn: (m: unknown) => void) => listeners.push(fn),
        removeListener: (fn: (m: unknown) => void) => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    },
  },
}));

vi.mock('../../extension/auth/auth-config', () => ({
  getAuthConfig: vi.fn().mockResolvedValue({
    provider: 'oidc',
    features: {
      supports_registration: false,
      supports_password_reset: false,
      supports_email_verification: false,
      requires_redirect: true,
    },
  }),
}));

describe('AuthScreen — SSO wait', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.length = 0;
    mockSendMessage.mockResolvedValue({ status: 'success' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function startSignIn() {
    render(<AuthScreen onAuthSuccess={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(mockSendMessage).toHaveBeenCalled());
  }

  it('stops waiting and restores the sign-in button when the flow never reports back', async () => {
    await startSignIn();

    // Mid-wait: still spinning, button disabled — this is the state that used
    // to be terminal.
    expect(screen.getByText(/Authenticating/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 1000 + 1000);
    });

    expect(screen.queryByText(/Authenticating/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/has not completed yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled();
  });

  it('honours a late success — the timeout restores the affordance, it cancels nothing', async () => {
    const onAuthSuccess = vi.fn();
    render(<AuthScreen onAuthSuccess={onAuthSuccess} />);
    fireEvent.click(await screen.findByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(mockSendMessage).toHaveBeenCalled());

    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 1000 + 1000);
    });
    expect(onAuthSuccess).not.toHaveBeenCalled();

    // The user finishes in the other tab after we gave up waiting.
    await act(async () => {
      listeners.forEach((fn) => fn({ type: 'auth_state_changed', authState: { isAuthenticated: true } }));
    });

    expect(onAuthSuccess).toHaveBeenCalled();
  });

  /**
   * A sign-OUT broadcast is not a sign-in.
   *
   * `AuthStateChangedEvent.authState` is `{ isAuthenticated, user? } | null`, so
   * `{ isAuthenticated: false }` is a truthy object. The listener used to test
   * it for presence, which meant a sign-out reached `onAuthSuccess` — and that
   * handler marks the session ending and reloads the panel, on a user who has
   * just been signed out. Latent only because every emitter sends
   * `authState: null` for a sign-out today.
   */
  it('ignores a sign-out broadcast that spells itself out rather than sending null', async () => {
    const onAuthSuccess = vi.fn();
    render(<AuthScreen onAuthSuccess={onAuthSuccess} />);
    await screen.findByRole('button', { name: /sign in/i });

    await act(async () => {
      listeners.forEach((fn) =>
        fn({ type: 'auth_state_changed', authState: { isAuthenticated: false } }),
      );
    });

    expect(onAuthSuccess).not.toHaveBeenCalled();
  });

  // The other spelling of a sign-out, and the one every emitter uses today.
  it('ignores a null auth state', async () => {
    const onAuthSuccess = vi.fn();
    render(<AuthScreen onAuthSuccess={onAuthSuccess} />);
    await screen.findByRole('button', { name: /sign in/i });

    await act(async () => {
      listeners.forEach((fn) => fn({ type: 'auth_state_changed', authState: null }));
    });

    expect(onAuthSuccess).not.toHaveBeenCalled();
  });

  it('does not warn before the timeout elapses', async () => {
    await startSignIn();

    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });

    expect(screen.queryByText(/has not completed yet/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Authenticating/i)).toBeInTheDocument();
  });
});
