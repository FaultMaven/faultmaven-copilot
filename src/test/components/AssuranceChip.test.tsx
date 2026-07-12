/**
 * Unit tests for ``AssuranceChip`` — the read-time cause-assurance label
 * (#572 / INV-28, §3.5). Pins that the grade is shown beside the RCC text for
 * the held-back grades, that the clean top grade (``confirmed``) renders no
 * qualifier, and that an over-claiming conclusion gets a caution marker.
 *
 * Mechanical / value-driven: the grade string decides the render, no model.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  AssuranceChip,
  hasAssuranceLabel,
} from '../../shared/ui/components/case-header/shared';

describe('AssuranceChip', () => {
  it('renders no qualifier for a counterfactually confirmed cause', () => {
    const { container } = render(<AssuranceChip grade="confirmed" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no grade is present', () => {
    const { container } = render(<AssuranceChip grade={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('labels a mechanistic (identified-but-unconfirmed) cause', () => {
    render(<AssuranceChip grade="mechanistic" />);
    expect(screen.getByText('Mechanistic')).toBeInTheDocument();
  });

  it('labels an unvalidated (assistant-stated) cause', () => {
    render(<AssuranceChip grade="no_root" />);
    expect(screen.getByText('Unvalidated')).toBeInTheDocument();
  });

  it('adds a caution marker when the conclusion over-claims', () => {
    render(<AssuranceChip grade="mechanistic" overclaim />);
    expect(screen.getByLabelText('over-claim caution')).toBeInTheDocument();
  });

  it('shows no caution marker when not over-claiming', () => {
    render(<AssuranceChip grade="mechanistic" overclaim={false} />);
    expect(screen.queryByLabelText('over-claim caution')).not.toBeInTheDocument();
  });
});

describe('hasAssuranceLabel', () => {
  // Lets a caller skip a wrapper element when the chip would render nothing
  // (avoids the empty spacer paragraph in ResolutionActionsCard).
  it('is true only for the held-back grades that render a chip', () => {
    expect(hasAssuranceLabel('mechanistic')).toBe(true);
    expect(hasAssuranceLabel('no_root')).toBe(true);
  });

  it('is false for confirmed, unknown, and empty grades', () => {
    expect(hasAssuranceLabel('confirmed')).toBe(false);
    expect(hasAssuranceLabel('bogus')).toBe(false);
    expect(hasAssuranceLabel(null)).toBe(false);
    expect(hasAssuranceLabel(undefined)).toBe(false);
  });
});
