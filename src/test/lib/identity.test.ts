import { describe, it, expect } from 'vitest';
import { accountInitials, elevatedRole, identityColor, IDENTITY_COLORS } from '~/lib/identity';

/**
 * These assertions are the cross-client contract, not local detail.
 *
 * The Dashboard ships a byte-identical `identity.ts`. If the two derivations
 * ever diverge, the same person renders in different colours in the two
 * clients — and a mismatch, which is the whole point of the colour, stops
 * meaning anything. The literal expectations below are what make a silent
 * divergence fail rather than merely look different.
 */
describe('identityColor', () => {
  it('is stable for the same user id', () => {
    expect(identityColor('user-abc')).toBe(identityColor('user-abc'));
  });

  it('pins concrete values, so a changed hash or palette order fails here', () => {
    // Not "some colour" — these exact pairings are the cross-client contract.
    expect(identityColor('550e8400-e29b-41d4-a716-446655440000')).toBe('#818CF8');
    expect(identityColor('user-abc')).toBe('#FB7185');
    expect(identityColor('sim-runner')).toBe('#F472B6');
  });

  it('always returns a palette entry', () => {
    for (let i = 0; i < 200; i++) {
      expect(IDENTITY_COLORS).toContain(identityColor(`user-${i}`));
    }
  });

  it('separates ids that differ only in their last character', () => {
    // The failure this guards is a hash that ignores tail bytes, which would
    // collapse sequentially-issued ids onto one colour.
    const colors = new Set(
      ['user-a', 'user-b', 'user-c', 'user-d'].map(identityColor),
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it('falls back to a real colour rather than throwing on a missing id', () => {
    expect(IDENTITY_COLORS).toContain(identityColor(undefined));
    expect(IDENTITY_COLORS).toContain(identityColor(null));
    expect(IDENTITY_COLORS).toContain(identityColor(''));
  });
});

describe('accountInitials', () => {
  it('takes first and last of a multi-word display name', () => {
    expect(accountInitials('Sterlan Yu')).toBe('SY');
    expect(accountInitials('Ada Byron Lovelace')).toBe('AL');
  });

  it('splits on the separators usernames actually use', () => {
    expect(accountInitials(undefined, 'sterlan.yu')).toBe('SY');
    expect(accountInitials(undefined, 'sterlan_yu')).toBe('SY');
    expect(accountInitials(undefined, 'sterlan-yu')).toBe('SY');
  });

  it('uses two letters when there is only one word', () => {
    expect(accountInitials('Prometheus')).toBe('PR');
  });

  it('falls back through username then the email local part', () => {
    expect(accountInitials(undefined, undefined, 'rae.kelmen@faultmaven.ai')).toBe('RK');
  });

  it('falls through a source that survives nothing of the filter', () => {
    // "🙂" and "---" are non-empty, so a first-non-empty-source chain would
    // stop there and render "?" while a perfectly good username sat unused.
    expect(accountInitials('🙂', 'sterlan.yu')).toBe('SY');
    expect(accountInitials('---', 'prometheus')).toBe('PR');
    expect(accountInitials('   ', undefined, 'rae.kelmen@faultmaven.ai')).toBe('RK');
  });

  it('never renders empty', () => {
    // The monogram is the only identity element in the collapsed rail, so an
    // empty string there would erase it entirely.
    expect(accountInitials('')).toBe('?');
    expect(accountInitials('   ')).toBe('?');
    expect(accountInitials('...')).toBe('?');
    expect(accountInitials(undefined, undefined, undefined)).toBe('?');
  });

  it('handles non-Latin names without dropping to the fallback', () => {
    expect(accountInitials('Ярослав Ким')).toBe('ЯК');
  });
});

describe('elevatedRole', () => {
  it('badges the cross-tenant operator role only', () => {
    expect(elevatedRole(['platform_admin'])).toBe('Platform admin');
  });

  it('does not badge the org-scoped admin role', () => {
    // `admin` is ordinary within its own organization (ADR-012 D9). Badging it
    // would make the elevated marker meaningless by making it common.
    expect(elevatedRole(['admin'])).toBeNull();
    expect(elevatedRole(['user'])).toBeNull();
  });

  it('is null for missing roles rather than throwing', () => {
    expect(elevatedRole(undefined)).toBeNull();
    expect(elevatedRole(null)).toBeNull();
    expect(elevatedRole([])).toBeNull();
  });
});
