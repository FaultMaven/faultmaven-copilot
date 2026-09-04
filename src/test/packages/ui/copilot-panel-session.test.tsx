/**
 * The shell cannot be rendered without a session.
 *
 * Two legs, because either alone is weak. The compile-time one is the real
 * guarantee — `@ts-expect-error` fails the build if the error ever STOPS
 * happening, so it catches the day someone widens the prop. The runtime one
 * says what happens if the type is bypassed (a cast, plain JS, a stale build):
 * it must be a thrown error, not an empty panel that quietly renders a
 * signed-out user's shell.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CopilotPanel from '@faultmaven/copilot-ui/shared/ui/CopilotPanel';
import { createStubHost } from '../../support/host';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { getEpoch } from '@faultmaven/copilot-ui/lib/state/session-epoch';
import type { HostCapabilities, HostUser, WiredHost } from '@faultmaven/copilot-ui/shared/host';

vi.mock('@faultmaven/copilot-ui/shared/ui/components/ConversationsList', () => ({
  default: () => <div data-testid="conversations-list" />,
}));

const withQueryClient = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
};

describe('CopilotPanel requires a session', () => {
  it('rejects a host with no session at compile time', () => {
    const { host } = createStubHost();
    // A host stripped of its session is exactly `HostCapabilities` — what the
    // extension exports before anyone signs in.
    const { session: _session, ...capabilitiesOnly } = host;
    const withoutSession: HostCapabilities = capabilitiesOnly;

    // If this line ever stops being an error, `@ts-expect-error` becomes one
    // and `pnpm compile` fails — which is the point. Never rendered.
    const _element = (
      // @ts-expect-error `host` requires a session; HostCapabilities has none.
      <CopilotPanel host={withoutSession} />
    );

    expect(withoutSession).not.toHaveProperty('session');
  });

  it('throws rather than rendering an empty panel when the type is bypassed', () => {
    const { host } = createStubHost();
    const { session: _session, ...capabilitiesOnly } = host;

    // The cast is the bypass being tested: plain JS, a stale build, or an
    // `as any` at a call site all arrive here.
    expect(() =>
      render(<CopilotPanel host={capabilitiesOnly as unknown as WiredHost} />, {
        wrapper: withQueryClient(),
      }),
    ).toThrow();
  });

  it('renders the panel when the host carries one', () => {
    const { host } = createStubHost();

    const { container } = render(<CopilotPanel host={host} />, {
      wrapper: withQueryClient(),
    });

    expect(container).not.toBeEmptyDOMElement();
    // And no sign-in anywhere in it.
    expect(container.textContent ?? '').not.toMatch(/sign in|log in|password/i);
  });
});

/**
 * The session can END while the panel is open, and the panel has to be told.
 *
 * It used to learn this from `runtime.onMessage` and from an extension storage
 * key it named itself — two extension mechanisms, in shared code, for one fact.
 * The fact is now a member on `HostSession`, and the panel subscribes to it.
 * Every host has the fact: the extension broadcasts it, and a web host has it
 * whenever another tab signs the browser out.
 */
describe('the panel reacts to the host reporting a sign-out', () => {
  const OPERATOR: HostUser = { id: 'u1', username: 'op', roles: ['user'] };

  beforeEach(() => {
    useAppStore.setState({ currentUser: OPERATOR });
  });

  it('subscribes through the session, and clears the identity when it reports null', async () => {
    const stub = createStubHost();

    render(<CopilotPanel host={stub.host} />, { wrapper: withQueryClient() });

    expect(stub.subscribeAuthState).toHaveBeenCalledTimes(1);

    await act(async () => {
      stub.authStateChanged(null);
    });

    expect(useAppStore.getState().currentUser).toBeNull();
  });

  // The fence, which is why this is a subscription and not a re-render. A
  // sign-out that landed in another context has to invalidate the writers
  // already in flight here, before anything else reacts to it (#143).
  it('fences the session so in-flight writers cannot repopulate it', async () => {
    const stub = createStubHost();
    render(<CopilotPanel host={stub.host} />, { wrapper: withQueryClient() });
    const before = getEpoch();

    await act(async () => {
      stub.authStateChanged(null);
    });

    expect(getEpoch()).not.toBe(before);
  });

  it('unsubscribes when the panel unmounts', async () => {
    const stub = createStubHost();
    const { unmount } = render(<CopilotPanel host={stub.host} />, { wrapper: withQueryClient() });

    unmount();
    useAppStore.setState({ currentUser: OPERATOR });
    await act(async () => {
      stub.authStateChanged(null);
    });

    expect(useAppStore.getState().currentUser).toEqual(OPERATOR);
  });
});
