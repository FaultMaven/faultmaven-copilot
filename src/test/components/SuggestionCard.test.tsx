import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { SuggestionCard } from '~/shared/ui/components/SuggestionCard';
import type { SuggestedAction } from '~/lib/api/types';

/**
 * Phase 6 visual linkage: EVIDENCE-type suggestions that carry a backend-
 * resolved `evidence_need_id` render a minimal visual marker so the user
 * sees continuity across turns. Minimal scope:
 *
 *   - bullet recolored to the accent token,
 *   - `title` attribute on the row showing the need id (hover discoverability),
 *   - `data-evidence-need-id` attribute (DevTools inspection + future hooks).
 *
 * Out of scope here (future PRs): dismiss / group-by-need affordances —
 * those require UX design decisions beyond what Phase 6's "make the
 * field available" goal contracts for.
 */

function _action(overrides: Partial<SuggestedAction>): SuggestedAction {
  return {
    label: 'Upload metrics',
    type: 'EVIDENCE',
    payload: 'kubectl top pods',
    ...overrides,
  };
}

describe('SuggestionCard — Phase 6 evidence_need_id visual linkage', () => {
  it('marks tracked EVIDENCE suggestions with the accent bullet color', () => {
    render(<SuggestionCard action={_action({ evidence_need_id: 'eneed_abc123def456' })} />);
    const bullet = screen.getByText('•');
    expect(bullet.className).toContain('text-fm-accent');
    expect(bullet.className).not.toContain('text-fm-text-tertiary');
  });

  it('shows the need id in the title attribute for hover discoverability', () => {
    const { container } = render(
      <SuggestionCard action={_action({ evidence_need_id: 'eneed_abc123def456' })} />,
    );
    const row = container.firstChild as HTMLElement;
    expect(row.getAttribute('title')).toBe(
      'Tracks open evidence need (id: eneed_abc123def456)',
    );
  });

  it('exposes the need id via data attribute for inspection', () => {
    const { container } = render(
      <SuggestionCard action={_action({ evidence_need_id: 'eneed_abc123def456' })} />,
    );
    const row = container.firstChild as HTMLElement;
    expect(row.getAttribute('data-evidence-need-id')).toBe('eneed_abc123def456');
  });

  it('uses the default bullet color when evidence_need_id is absent', () => {
    render(<SuggestionCard action={_action({ evidence_need_id: undefined })} />);
    const bullet = screen.getByText('•');
    expect(bullet.className).toContain('text-fm-text-tertiary');
    expect(bullet.className).not.toContain('text-fm-accent');
  });

  it('does NOT mark non-EVIDENCE suggestions even if evidence_need_id is set', () => {
    // The schema-side validator rejects this combination upstream, but the
    // component defensively gates on action.type so a misrouted suggestion
    // doesn't end up with mismatched styling.
    const { container } = render(
      <SuggestionCard
        action={_action({
          type: 'COOPERATIVE',
          cooperative_action: 'query_submit',
          evidence_need_id: 'eneed_abc123def456',
        })}
      />,
    );
    const bullet = screen.getByText('•');
    expect(bullet.className).toContain('text-fm-text-tertiary');
    const row = container.firstChild as HTMLElement;
    expect(row.getAttribute('title')).toBe(null);
    expect(row.getAttribute('data-evidence-need-id')).toBe(null);
  });

  it('preserves existing EVIDENCE rendering when no need id is present', () => {
    // Regression guard: the marker logic must not disturb the existing
    // EVIDENCE styling for ad-hoc evidence requests (no persistent need).
    render(<SuggestionCard action={_action({ body: 'why: timeline reconstruction' })} />);
    expect(screen.getByText('Upload metrics')).toBeInTheDocument();
    expect(screen.getByText(/why: timeline reconstruction/)).toBeInTheDocument();
  });
});
