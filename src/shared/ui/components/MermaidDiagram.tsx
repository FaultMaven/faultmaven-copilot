import { useEffect, useId, useState } from 'react';

// Lazy-load mermaid so the library builds as its own chunk, bundled inside
// the extension (MV3 CSP is script-src 'self' — no CDN) and fetched only
// when a message actually contains a diagram.
let mermaidModule: Promise<typeof import('mermaid')> | null = null;
function loadMermaid() {
  mermaidModule ??= import('mermaid').then((mod) => {
    mod.default.initialize({
      startOnLoad: false,
      // Chat markdown is user/LLM-authored — treat diagram sources as
      // untrusted content.
      securityLevel: 'strict',
      theme: 'dark',
      fontFamily: 'inherit',
    });
    return mod;
  });
  return mermaidModule;
}

interface MermaidDiagramProps {
  chart: string;
}

interface RenderState {
  chart: string;
  svg: string | null;
  failed: boolean;
}

/**
 * Renders a mermaid diagram source (e.g. the engine-generated Causal Map
 * embedded in the closure-turn resolution summary) as an inline SVG.
 * Fail-closed: if mermaid cannot parse the source, the raw text renders as
 * the plain code block it was before mermaid support.
 */
export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const [state, setState] = useState<RenderState>({ chart, svg: null, failed: false });
  const renderId = `mmd-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  // Reset for a new chart during render so the effect stays async-only.
  if (state.chart !== chart) {
    setState({ chart, svg: null, failed: false });
  }

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then(({ default: mermaid }) => mermaid.render(renderId, chart))
      .then((result) => {
        if (!cancelled) setState({ chart, svg: result.svg, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ chart, svg: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [chart, renderId]);

  if (state.failed) {
    return (
      <pre className="bg-fm-codeblock text-fm-codeblock-text p-3 rounded-md overflow-x-auto my-2 border border-fm-codeblock-border">
        <code className="text-xs font-mono">{chart}</code>
      </pre>
    );
  }
  if (!state.svg) {
    return (
      <div className="text-xs opacity-60 py-2" aria-busy="true">
        Rendering diagram…
      </div>
    );
  }
  return (
    <div
      className="overflow-x-auto my-2 [&_svg]:max-w-full [&_svg]:h-auto"
      role="img"
      // Mermaid output under securityLevel 'strict' is sanitized SVG.
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
