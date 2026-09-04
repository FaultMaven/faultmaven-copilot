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
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CopilotPanel from '../../../shared/ui/CopilotPanel';
import { createStubHost } from '../../support/host';
import type { HostCapabilities, WiredHost } from '../../../shared/host';

vi.mock('../../../shared/ui/components/ConversationsList', () => ({
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
