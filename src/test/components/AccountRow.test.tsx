/**
 * Unit tests for ``AccountRow`` — the "which account is this panel signed in
 * as" row in the side-panel navigation.
 *
 * The pure presentation helpers (initials, colour, elevated role) are pinned in
 * ``src/test/lib/identity.test.ts``. What is pinned here is the behaviour
 * around the ``/auth/me`` read, which is where the row can render a *wrong*
 * identity rather than merely an ugly one:
 *
 *  - it survives the sidebar collapse toggle without refetching (the collapsed
 *    rail is a separate subtree in CollapsibleNavigation, so the component
 *    unmounts and remounts on every toggle);
 *  - an A→B account switch never pairs B's name with A's organization or role;
 *  - a profile with no usable organization name falls back to the email rather
 *    than blanking the line;
 *  - a failed profile read degrades to the stored identity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountRow } from '@faultmaven/copilot-ui/shared/ui/components/AccountRow';
import type { UserProfile } from '@faultmaven/copilot-ui/lib/api/types';
import type { HostUser } from '@faultmaven/copilot-ui/shared/host';

const getCurrentUser = vi.hoisted(() => vi.fn());
vi.mock('@faultmaven/copilot-ui/lib/api/services/user-service', () => ({ getCurrentUser }));

// The identity the HOST publishes, which is the one the row renders now — the
// store's second copy of the same person is gone.
const ALICE: HostUser = {
  id: 'user-alice',
  username: 'alice',
  email: 'alice@example.com',
  displayName: 'Alice Ng',
  roles: ['user'],
};

const BOB: HostUser = {
  id: 'user-bob',
  username: 'bob',
  email: 'bob@other.example',
  displayName: 'Bob Reyes',
  roles: ['user'],
};

function profileFor(user: HostUser, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    user_id: user.id,
    username: user.username,
    email: user.email ?? '',
    display_name: user.displayName ?? '',
    created_at: '2026-01-01T00:00:00Z',
    is_dev_user: false,
    roles: user.roles,
    ...overrides,
  };
}

let queryClient: QueryClient;

function renderRow(user: HostUser | null, collapsed = false) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountRow user={user} collapsed={collapsed} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  getCurrentUser.mockReset();
  // A shared client across renders in a test — that is the point: the cache is
  // what has to outlive the unmount.
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('AccountRow', () => {
  it('renders nothing before the auth state resolves', () => {
    const { container } = renderRow(null);
    expect(container).toBeEmptyDOMElement();
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it('shows the organization once the profile lands', async () => {
    getCurrentUser.mockResolvedValue(
      profileFor(ALICE, { organization: { organization_id: 'org-1', name: 'Acme Ops' } })
    );

    renderRow(ALICE);

    expect(screen.getByText('Alice Ng')).toBeInTheDocument();
    // Before the read resolves, the stored email holds the line.
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Acme Ops')).toBeInTheDocument());
  });

  // The collapse toggle unmounts this component. Local state would refetch on
  // every toggle and flip the second line back to the email each time.
  it('does not refetch the profile when the sidebar is toggled', async () => {
    getCurrentUser.mockResolvedValue(
      profileFor(ALICE, { organization: { organization_id: 'org-1', name: 'Acme Ops' } })
    );

    const expanded = renderRow(ALICE);
    await waitFor(() => expect(screen.getByText('Acme Ops')).toBeInTheDocument());
    expect(getCurrentUser).toHaveBeenCalledTimes(1);

    // Collapse: CollapsibleNavigation returns an entirely different subtree.
    expanded.unmount();
    const collapsed = renderRow(ALICE, true);
    collapsed.unmount();
    // ...and expand again.
    renderRow(ALICE);

    expect(screen.getByText('Acme Ops')).toBeInTheDocument();
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  // The failure this row exists to prevent: telling the user they are in an
  // account they are not in.
  it('never pairs one account with another account\'s organization or role', async () => {
    getCurrentUser.mockResolvedValue(
      profileFor(ALICE, {
        roles: ['platform_admin'],
        organization: { organization_id: 'org-1', name: 'Acme Ops' },
      })
    );

    const first = renderRow(ALICE);
    await waitFor(() => expect(screen.getByText('Acme Ops')).toBeInTheDocument());
    expect(screen.getByText('Platform admin')).toBeInTheDocument();

    // Switch to Bob without passing through null, and let his read hang.
    getCurrentUser.mockReturnValue(new Promise(() => {}));
    first.unmount();
    renderRow(BOB);

    expect(screen.getByText('Bob Reyes')).toBeInTheDocument();
    expect(screen.queryByText('Acme Ops')).not.toBeInTheDocument();
    expect(screen.queryByText('Platform admin')).not.toBeInTheDocument();
    expect(screen.getByText('bob@other.example')).toBeInTheDocument();
  });

  it('falls back to the email when the organization has no usable name', async () => {
    getCurrentUser.mockResolvedValue(
      profileFor(ALICE, { organization: { organization_id: 'org-1', name: '  ' } })
    );

    renderRow(ALICE);

    await waitFor(() => expect(getCurrentUser).toHaveBeenCalled());
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('degrades to the stored identity when the profile read fails', async () => {
    getCurrentUser.mockRejectedValue(new Error('session expired'));

    renderRow(ALICE);

    await waitFor(() => expect(getCurrentUser).toHaveBeenCalled());
    expect(screen.getByText('Alice Ng')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  // `admin` is organization-scoped and ordinary within its own org; only the
  // cross-tenant operator role is badged, and it is spelled out so the badge
  // cannot be read as naming the role that was excluded.
  it('badges platform_admin by its full name and leaves org admin unbadged', async () => {
    getCurrentUser.mockResolvedValue(profileFor(ALICE, { roles: ['admin'] }));
    const orgAdmin = renderRow(ALICE);
    await waitFor(() => expect(getCurrentUser).toHaveBeenCalled());
    expect(screen.queryByText(/admin/i)).not.toBeInTheDocument();
    orgAdmin.unmount();
    queryClient.clear();

    getCurrentUser.mockResolvedValue(profileFor(BOB, { roles: ['platform_admin'] }));
    renderRow(BOB);
    await waitFor(() => expect(screen.getByText('Platform admin')).toBeInTheDocument());
  });

  // A `title` on a non-focusable div reaches neither keyboard nor touch, so the
  // announced text has to carry what distinguishes two accounts. On the rail
  // nothing at all is visible — the monogram is aria-hidden.
  it('announces the email and organization on the collapsed rail', async () => {
    getCurrentUser.mockResolvedValue(
      profileFor(ALICE, { organization: { organization_id: 'org-1', name: 'Acme Ops' } })
    );

    renderRow(ALICE, true);

    await waitFor(() =>
      expect(
        screen.getByText('Signed in as Alice Ng, alice@example.com, Acme Ops')
      ).toBeInTheDocument()
    );
  });

  // Expanded, the tenant displaces the email from the visible line; it must not
  // disappear from the announced content with it.
  it('announces the email when the organization displaced it', async () => {
    getCurrentUser.mockResolvedValue(
      profileFor(ALICE, { organization: { organization_id: 'org-1', name: 'Acme Ops' } })
    );

    renderRow(ALICE);

    await waitFor(() => expect(screen.getByText('Acme Ops')).toBeInTheDocument());
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });
});
