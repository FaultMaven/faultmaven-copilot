import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import InlineSourcesRenderer from '@faultmaven/copilot-ui/shared/ui/components/InlineSourcesRenderer';
import type { Source } from '@faultmaven/copilot-ui/lib/api';

// Sources exactly as the backend's KB pre-fetch emits them
// (`_kb_context_sources`): the excerpt as `content`, the retrieval score as
// `confidence`, and the runbook's id and title under `metadata`.
const kb = (n: number, over: Partial<Source> = {}): Source => ({
  type: 'knowledge_base',
  content: `Excerpt ${n}.`,
  confidence: 0.82,
  metadata: { document_id: `doc-${n}`, title: `Runbook ${n}`, trigger: 'symptom' },
  ...over,
});

describe('InlineSourcesRenderer — runbooks in context', () => {
  it('lists every source under the reply, whatever shape the reply takes', () => {
    // A reply of bullets and a heading has no paragraph to pin a marker to.
    render(
      <InlineSourcesRenderer
        content={'## Steps\n\n- rotate the secret\n- restart the pods'}
        sources={[kb(1), kb(2), kb(3), kb(4)]}
      />
    );

    expect(screen.getByText('📚 4 runbooks in context')).toBeInTheDocument();
    for (const n of [1, 2, 3, 4]) {
      expect(screen.getByText(`Runbook ${n}`)).toBeInTheDocument();
    }
  });

  it('shows each source\'s kind, relevance and verification status', () => {
    render(
      <InlineSourcesRenderer content="Done." sources={[kb(1, { verification_status: 'verified' })]} />
    );

    expect(screen.getByText(/Knowledge Base/)).toBeInTheDocument();
    expect(screen.getByText('82% relevance')).toBeInTheDocument();
    expect(screen.getByText(/verified/)).toBeInTheDocument();
  });

  it('opens a runbook from a real button, without hovering', () => {
    const onDocumentView = vi.fn();
    render(<InlineSourcesRenderer content="Done." sources={[kb(1)]} onDocumentView={onDocumentView} />);

    const open = screen.getByRole('button', { name: /Open runbook/ });
    fireEvent.click(open);
    expect(onDocumentView).toHaveBeenCalledWith('doc-1');
  });

  it('falls back to a numbered title and no link when metadata is null', () => {
    render(
      <InlineSourcesRenderer content="Done." sources={[kb(1, { metadata: null })]} onDocumentView={vi.fn()} />
    );

    expect(screen.getByText('Source 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open runbook/ })).not.toBeInTheDocument();
  });

  it('pins no marker to the reply text', () => {
    render(<InlineSourcesRenderer content="Based on the runbook, rotate the secret now." sources={[kb(1)]} />);
    expect(screen.queryByText('[1]')).not.toBeInTheDocument();
  });

  // The markdown components are element TYPES to react-markdown; rebuilt per
  // render, they remounted every paragraph on any parent re-render.
  it('keeps the rendered markdown mounted across a re-render', () => {
    const { rerender } = render(
      <InlineSourcesRenderer content="A paragraph that stays put." sources={[]} onDocumentView={vi.fn()} />
    );
    const before = screen.getByText('A paragraph that stays put.');

    rerender(<InlineSourcesRenderer content="A paragraph that stays put." sources={[]} onDocumentView={vi.fn()} />);

    expect(screen.getByText('A paragraph that stays put.')).toBe(before);
  });

  it('renders no list when there are no sources', () => {
    render(<InlineSourcesRenderer content="Done." sources={[]} />);
    expect(screen.queryByText(/in context/)).not.toBeInTheDocument();
  });
});
