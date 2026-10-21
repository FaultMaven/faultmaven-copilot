import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { MermaidConfig } from 'mermaid';
import InlineSourcesRenderer from '@faultmaven/copilot-ui/shared/ui/components/InlineSourcesRenderer';
import { MERMAID_CONFIG } from '@faultmaven/copilot-ui/mermaid-config';

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
    // order-independent. initializeMock is reset only by the test that
    // counts it, which takes a fresh module registry for the purpose.
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

  it('initializes mermaid exactly once, with the one site config', async () => {
    // A fresh registry, so the loader's memo and the svg cache start empty.
    // Under the file's earlier renders, a lost memo would go unseen.
    vi.resetModules();
    initializeMock.mockClear();
    const { MermaidDiagram } = await import(
      '@faultmaven/copilot-ui/shared/ui/components/MermaidDiagram'
    );
    const fresh = await import('@faultmaven/copilot-ui/mermaid-config');
    // Two charts no other test renders, so both reach the loader.
    const { container } = render(
      <>
        <MermaidDiagram chart={'flowchart LR\n  once1 --> once2'} />
        <MermaidDiagram chart={'flowchart LR\n  once3 --> once4'} />
      </>
    );
    await waitFor(() => expect(container.querySelectorAll('[role="img"]')).toHaveLength(2));
    expect(renderMock).toHaveBeenCalledTimes(2);
    expect(initializeMock).toHaveBeenCalledTimes(1);
    // The same object, not an equal copy: every host initializes from it.
    expect(initializeMock.mock.calls[0][0]).toBe(fresh.MERMAID_CONFIG);
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

  it('reuses the cached SVG when a rendered chart mounts again', async () => {
    const content = '```mermaid\nflowchart LR\n  cached1 --> cached2\n```';
    const first = render(<InlineSourcesRenderer content={content} />);
    await waitFor(() => expect(first.container.querySelector('[role="img"]')).toBeInTheDocument());
    expect(renderMock).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = render(<InlineSourcesRenderer content={content} />);
    // The cached SVG is there on the first paint, with no loading placeholder.
    expect(second.container.querySelector('[role="img"]')).toBeInTheDocument();
    // Drain the effect's promise chain: a render it started would land here.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(renderMock).toHaveBeenCalledTimes(1);
  });
});

describe('MERMAID_CONFIG', () => {
  it('pins the untrusted-content config and the pre-12 look', () => {
    // Strict: an added key set to undefined would replace mermaid's default.
    expect(MERMAID_CONFIG).toStrictEqual({
      startOnLoad: false,
      // securityLevel 'strict' is the premise of rendering mermaid output via
      // dangerouslySetInnerHTML — a change here is a security regression.
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'dark',
      fontFamily: 'inherit',
      // mermaid 12 re-lays out and resizes nodes unless these are pinned; they
      // keep the pre-12 look (fm#2118).
      layout: 'dagre',
      look: 'classic',
      flowchart: { minNodeWidth: 0, wrappingWidth: 200 },
      state: { minNodeWidth: 0, wrappingWidth: 200 },
      // The root layout must not replace these types' own layouts.
      swimlane: { layout: 'swimlane' },
      mindmap: { layout: 'cose-bilkent' },
      // A diagram's front matter or %%{init}%% must not pick a layout,
      // and mermaid's default secure keys stay secure.
      secure: [
        'secure',
        'securityLevel',
        'startOnLoad',
        'maxTextSize',
        'suppressErrorRendering',
        'maxEdges',
        'layout',
      ],
    });
  });

  it('is read-only to the type checker (`pnpm compile` fails on a write)', () => {
    // Never called: only tsc reads this, and it must reject the write.
    const rewrite = () => {
      // @ts-expect-error -- a host must not rewrite what every later initializer reads
      MERMAID_CONFIG.theme = 'default';
    };
    expect(rewrite).toBeTypeOf('function');
  });

  it('is frozen all the way down, so a host write throws', () => {
    const writable = MERMAID_CONFIG as MermaidConfig;
    const secure = MERMAID_CONFIG.secure as string[];
    const flowchart = MERMAID_CONFIG.flowchart as { wrappingWidth?: number };
    expect(() => {
      writable.theme = 'default';
    }).toThrow(TypeError);
    expect(() => secure.push('x')).toThrow(TypeError);
    expect(() => {
      secure.length = 0;
    }).toThrow(TypeError);
    expect(() => {
      flowchart.wrappingWidth = 1;
    }).toThrow(TypeError);
    expect([MERMAID_CONFIG.theme, secure.length, flowchart.wrappingWidth]).toEqual(['dark', 7, 200]);
  });
});
