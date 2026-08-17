import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import InlineSourcesRenderer from '../../shared/ui/components/InlineSourcesRenderer';

// jsdom cannot lay out real diagrams, so pin the routing contract instead:
// ```mermaid fences reach mermaid.render, other fences stay code blocks,
// and a parse failure falls back to the raw source.
const renderMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ svg: '<svg data-testid="mmd-svg"></svg>' })
);
vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: renderMock },
}));

describe('mermaid routing in chat markdown', () => {
  it('renders mermaid fences as diagrams', async () => {
    const { container } = render(
      <InlineSourcesRenderer
        content={'## Causal Map\n\n```mermaid\nflowchart LR\n  a --> b\n```'}
      />
    );
    await waitFor(() =>
      expect(container.querySelector('[role="img"]')).toBeInTheDocument()
    );
    expect(renderMock).toHaveBeenCalledWith(
      expect.any(String),
      'flowchart LR\n  a --> b'
    );
  });

  it('leaves other fences as code blocks', () => {
    const { container } = render(
      <InlineSourcesRenderer content={'```python\nprint(1)\n```'} />
    );
    expect(container.querySelector('pre')).toBeInTheDocument();
    expect(container.querySelector('[role="img"]')).not.toBeInTheDocument();
  });

  it('falls back to raw source when mermaid cannot parse', async () => {
    renderMock.mockRejectedValueOnce(new Error('parse error'));
    render(<InlineSourcesRenderer content={'```mermaid\nnot a diagram\n```'} />);
    await waitFor(() =>
      expect(screen.getByText('not a diagram')).toBeInTheDocument()
    );
  });
});
