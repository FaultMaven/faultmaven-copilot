import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import InlineSourcesRenderer from '@faultmaven/copilot-ui/shared/ui/components/InlineSourcesRenderer';

// jsdom cannot lay out real diagrams, so pin the routing contract instead:
// ```mermaid fences reach mermaid.render, other fences stay code blocks,
// and a parse failure falls back to the raw source.
const renderMock = vi.hoisted(() => vi.fn());
const initializeMock = vi.hoisted(() => vi.fn());
vi.mock('mermaid', () => ({
  default: { initialize: initializeMock, render: renderMock },
}));

describe('mermaid routing in chat markdown', () => {
  beforeEach(() => {
    // Reset call history AND queued one-shot results so tests stay
    // order-independent. initializeMock is deliberately not reset: the
    // module-level mermaid cache runs initialize once per file.
    renderMock.mockReset();
    renderMock.mockResolvedValue({ svg: '<svg data-testid="mmd-svg"></svg>' });
  });

  it('renders mermaid fences as diagrams, unwrapped from <pre>', async () => {
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
    // The pre override must unwrap the diagram from the markdown <pre>.
    expect(container.querySelector('pre')).not.toBeInTheDocument();
  });

  it('initializes mermaid with the untrusted-content config', async () => {
    render(
      <InlineSourcesRenderer content={'```mermaid\nflowchart LR\n  a --> b\n```'} />
    );
    await waitFor(() => expect(initializeMock).toHaveBeenCalled());
    // securityLevel 'strict' is the premise of rendering mermaid output via
    // dangerouslySetInnerHTML — a change here is a security regression.
    expect(initializeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
      })
    );
  });

  it('leaves other fences as code blocks', () => {
    const { container } = render(
      <InlineSourcesRenderer content={'```python\nprint(1)\n```'} />
    );
    const pre = container.querySelector('pre');
    expect(pre).toBeInTheDocument();
    // react-markdown's hast `node` prop must not leak onto the DOM element.
    expect(pre?.hasAttribute('node')).toBe(false);
    expect(container.querySelector('[role="img"]')).not.toBeInTheDocument();
  });

  it('falls back to raw source when mermaid cannot parse', async () => {
    renderMock.mockRejectedValueOnce(new Error('parse error'));
    render(<InlineSourcesRenderer content={'```mermaid\nnot a diagram\n```'} />);
    await waitFor(() =>
      expect(screen.getByText('not a diagram')).toBeInTheDocument()
    );
  });

  it('falls back to raw source when sanitization strips the whole svg', async () => {
    // Unique chart source: the component memoizes rendered SVG per chart,
    // so reusing another test's chart would skip mermaid.render entirely.
    renderMock.mockResolvedValueOnce({ svg: '   ' });
    render(<InlineSourcesRenderer content={'```mermaid\nflowchart TD\n  x\n```'} />);
    await waitFor(() =>
      expect(screen.getByText(/flowchart TD/)).toBeInTheDocument()
    );
  });
});
