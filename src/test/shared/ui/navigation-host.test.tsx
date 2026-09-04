/**
 * The navigation boundary, asserted through the rendered UI.
 *
 * `settings: null` is not "a callback that does nothing" — it is a host with no
 * settings surface, and the requirement is that the shared UI then draws no
 * settings affordance at all. That is a statement about what is on screen, so
 * these tests look at the screen rather than at the adapter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createStubHost, hostWrapper } from '../../support/host';
import type { WiredHost } from '../../../shared/host';

// AccountRow issues a profile query; the nav cannot mount without a client.
const withHost = (host: WiredHost) => {
  const Host = hostWrapper(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <Host>{children}</Host>
      </QueryClientProvider>
    );
  };
};

// ConversationsList fetches the case list on mount; this file is about the
// footer controls, not the list.
vi.mock('../../../shared/ui/components/ConversationsList', () => ({
  default: () => <div data-testid="conversations-list" />,
}));

vi.mock('../../../lib/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { CollapsibleNavigation } from '../../../shared/ui/layouts/CollapsibleNavigation';
import type { HostUser } from '../../../shared/host';

// The real `HostUser`, not a convenient subset — a partial fixture would hide a
// field the component starts depending on.
const USER: HostUser = {
  id: 'u1',
  username: 'op',
  email: 'op@example.invalid',
  displayName: 'Op',
  roles: [],
};

const navProps = (over: Record<string, unknown> = {}) => ({
  currentUser: USER,
  isCollapsed: false,
  onToggleCollapse: vi.fn(),
  activeTab: 'copilot' as const,
  activeCaseId: undefined,
  sessionId: undefined,
  hasUnsavedNewChat: false,
  isAdmin: false,
  conversationTitles: {},
  pinnedCases: new Set<string>(),
  refreshTrigger: 0,
  onTabChange: vi.fn(),
  onOpenDashboard: vi.fn(),
  onCaseSelect: vi.fn(),
  onNewChat: vi.fn(),
  onLogout: vi.fn(),
  onCaseTitleChange: vi.fn(),
  onPinToggle: vi.fn(),
  onAfterDelete: vi.fn(),
  onCasesLoaded: vi.fn(),
  ...over,
});

describe('CollapsibleNavigation — settings affordance follows the host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const collapsed of [false, true]) {
    const layout = collapsed ? 'collapsed rail' : 'expanded footer';

    it(`${layout}: renders a Settings button when the host has a settings surface`, () => {
      const stub = createStubHost();
      render(<CollapsibleNavigation {...navProps({ isCollapsed: collapsed })} />, {
        wrapper: withHost(stub.host),
      });

      const button = screen.getByTitle('Settings');
      fireEvent.click(button);
      expect(stub.settings).toHaveBeenCalledTimes(1);
    });

    it(`${layout}: renders NO Settings button when the host has none`, () => {
      const stub = createStubHost({}, { settings: false });
      expect(stub.host.navigation.settings).toBeNull();

      render(<CollapsibleNavigation {...navProps({ isCollapsed: collapsed })} />, {
        wrapper: withHost(stub.host),
      });

      // Not "present but disabled" and not "present but inert" — absent.
      expect(screen.queryByTitle('Settings')).toBeNull();
      // The neighbouring control is still there, so this is not an empty render.
      expect(screen.getByTitle('Logout')).toBeInTheDocument();
    });
  }
});
