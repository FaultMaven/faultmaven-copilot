import { useEffect, useState } from 'react';
import { accountInitials, elevatedRole, identityColor } from '~/lib/identity';
import { getCurrentUser } from '~/lib/api/services/auth-service';
import type { User, UserProfile } from '~/lib/api/types';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('AccountRow');

interface AccountRowProps {
  user: User | null;
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
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // The organization is only on /auth/me — the stored auth payload carries no
  // tenant name. Fetched once per signed-in user; a failure just leaves the
  // line out, since the identity above it is what the row exists to show.
  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    getCurrentUser()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((error) => {
        log.debug('Could not load account profile; showing stored identity', error);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.user_id]);

  if (!user) return null;

  const name = user.display_name || user.username;
  const initials = accountInitials(user.display_name, user.username, user.email);
  const color = identityColor(user.user_id);
  const role = elevatedRole(profile?.roles ?? user.roles);
  const organization = profile?.organization ?? null;

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
        title={`${name} — ${user.email}${organization ? ` · ${organization.name}` : ''}`}
      >
        {monogram}
        <span className="sr-only">Signed in as {name}</span>
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
          {organization ? organization.name : user.email}
        </span>
      </div>
      {role && (
        <span
          className="ml-auto shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide text-fm-warning bg-fm-warning-bg border border-fm-warning-border"
          title={role}
        >
          Admin
        </span>
      )}
    </div>
  );
}
