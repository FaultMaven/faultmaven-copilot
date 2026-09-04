import { useQuery } from '@tanstack/react-query';
import { accountInitials, elevatedRole, identityColor } from '../../../lib/identity';
import { getCurrentUser } from '../../../lib/api/services/user-service';
import type { UserProfile } from '../../../lib/api/types';
import type { HostUser } from '../../host';

interface AccountRowProps {
  /** The signed-in identity, as the HOST publishes it. */
  user: HostUser | null;
  /** Collapsed rail: the monogram alone carries the identity. */
  collapsed: boolean;
}

/**
 * Which account this panel is signed in as.
 *
 * The Copilot and the Dashboard hold independent token chains, so the same
 * browser can be signed into both as different people. The monogram colour is
 * derived from `user_id` by the shared helper both clients use, so the same
 * person is the same colour in each and a mismatch is visible without reading.
 */
export function AccountRow({ user, collapsed }: AccountRowProps) {
  // The organization is only on /auth/me — the stored auth payload carries no
  // tenant name.
  //
  // Held in the query cache rather than component state because this component
  // is NOT stable across a sidebar toggle: the collapsed rail is an early
  // return in CollapsibleNavigation, so the two <AccountRow> sites are separate
  // subtree positions and toggling unmounts/remounts. Local state would reset
  // and refire /auth/me on every toggle, flipping the second line back to the
  // email each time and spending reads against the per-session limit.
  //
  // Keyed on user_id so an A→B account switch cannot render B's name beside A's
  // organization and role: the new key has no data, so the row falls back to
  // the stored identity until B's own profile lands. A failure leaves the line
  // out for the same reason — the identity above it is what the row exists to
  // show, so there is nothing to retry for.
  const { data: profile } = useQuery<UserProfile>({
    queryKey: ['accountProfile', user?.id],
    queryFn: () => getCurrentUser(),
    enabled: Boolean(user?.id),
    retry: false,
    // Explicit rather than inherited from the shared client's 5-minute default:
    // "one read per signed-in account" is a property of this row, and the
    // toggle-remount above would otherwise turn any expiry into a request per
    // toggle. Keyed on user_id, so a different account is a different entry;
    // for one account the tenant and role are fixed for the panel's lifetime.
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (!user) return null;

  const name = user.displayName || user.username;
  const initials = accountInitials(user.displayName, user.username, user.email);
  const color = identityColor(user.id);
  const role = elevatedRole(profile?.roles ?? user.roles);
  // Branch on the NAME, not on the object: `organization` is hand-written
  // rather than generated, and one returned without a usable name would
  // otherwise blank the line instead of falling back to the email.
  const orgName = profile?.organization?.name?.trim() || null;

  // Everything that distinguishes two accounts, for the readers who get no
  // tooltip — a `title` on a non-focusable div reaches neither keyboard nor
  // touch, and the display name is the field most likely to collide.
  const spokenIdentity = `Signed in as ${name}, ${user.email}${orgName ? `, ${orgName}` : ''}`;

  const monogram = (
    <span
      className="w-7 h-7 rounded-full grid place-items-center text-[10px] font-bold text-fm-base shrink-0"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );

  // Collapsed, the row is one element wide. The full account goes in the title
  // so it stays reachable rather than merely implied by a colour.
  if (collapsed) {
    return (
      <div
        className="flex justify-center"
        title={`${name} — ${user.email}${orgName ? ` · ${orgName}` : ''}`}
      >
        {monogram}
        <span className="sr-only">{spokenIdentity}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-0" title={user.email}>
      {monogram}
      <div className="flex flex-col min-w-0">
        <span className="text-fm-xs font-medium text-fm-text-primary truncate">
          {name}
        </span>
        <span className="text-[10px] text-fm-text-tertiary truncate">
          {orgName ?? user.email}
        </span>
        {/* Expanded, the name and the tenant are already visible text, so only
            the email needs announcing — and only when the tenant displaced it.
            It sits in a `title` otherwise, which reaches neither keyboard nor
            touch. */}
        {orgName && <span className="sr-only">{user.email}</span>}
      </div>
      {role && (
        // Spelled out rather than badged "Admin": elevatedRole fires only for
        // platform_admin, and org-scoped `admin` is deliberately not badged at
        // all — a badge reading "Admin" would name the excluded role.
        <span
          className="ml-auto shrink-0 max-w-[92px] truncate px-1.5 py-0.5 rounded text-[9px] font-semibold text-fm-warning bg-fm-warning-bg border border-fm-warning-border"
          title={role}
        >
          {role}
        </span>
      )}
    </div>
  );
}
