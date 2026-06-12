import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

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
          type: 'DECIDE',
          payload: 'Yes, proceed',
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

  it('renders a payload-less FREE_SPEECH as a non-clickable user-voiced line', () => {
    // payload belongs to the clickable types (DECIDE/RUN); FREE_SPEECH
    // carries everything in the user-voiced label + hints, never clickable.
    const { container } = render(
      <SuggestionCard
        action={_action({
          label: "Share what I'm seeing in my environment",
          type: 'FREE_SPEECH',
          payload: undefined,
          hints: ['symptoms', 'timeline'],
        })}
        isCurrentTurn
      />,
    );
    expect(
      screen.getByText("Share what I'm seeing in my environment"),
    ).toBeInTheDocument();
    expect(screen.getByText(/symptoms · timeline/)).toBeInTheDocument();
    const row = container.firstChild as HTMLElement;
    expect(row.getAttribute('role')).toBe(null); // not a button
  });
});


describe('SuggestionCard — DECIDE/RUN click encoding', () => {
  it('DECIDE click invokes the callback with the payload (submit path)', () => {
    const onClick = vi.fn();
    render(
      <SuggestionCard
        action={_action({ label: 'Yes, investigate', type: 'DECIDE', payload: 'Yes, let us investigate' })}
        isCurrentTurn
        onClickableSuggestion={onClick}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith('Yes, let us investigate', 'DECIDE', undefined);
  });

  it('RUN click copies the command to the clipboard and reports type RUN', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const onClick = vi.fn();
    render(
      <SuggestionCard
        action={_action({ label: 'Get pod logs', type: 'RUN', payload: 'kubectl logs <pod> --tail=100' })}
        isCurrentTurn
        onClickableSuggestion={onClick}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(writeText).toHaveBeenCalledWith('kubectl logs <pod> --tail=100');
    expect(onClick).toHaveBeenCalledWith('kubectl logs <pod> --tail=100', 'RUN', undefined);
  });

  it('EVIDENCE and FREE_SPEECH are never clickable, even on the current turn', () => {
    for (const type of ['EVIDENCE', 'FREE_SPEECH'] as const) {
      const { container, unmount } = render(
        <SuggestionCard action={_action({ type, payload: undefined })} isCurrentTurn />,
      );
      expect((container.firstChild as HTMLElement).getAttribute('role')).toBe(null);
      unmount();
    }
  });

  it('clickable suggestions from past turns are inert and dimmed', () => {
    const onClick = vi.fn();
    const { container } = render(
      <SuggestionCard
        action={_action({ label: 'Yes', type: 'DECIDE', payload: 'Yes' })}
        isCurrentTurn={false}
        onClickableSuggestion={onClick}
      />,
    );
    const row = container.firstChild as HTMLElement;
    expect(row.getAttribute('role')).toBe(null);
    expect(row.className).toContain('opacity-50');
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
  });
});
