import { useEffect, useState } from 'react';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('MermaidDiagram');

// Lazy-load mermaid so the library builds as its own chunk, bundled inside
// the extension (MV3 CSP is script-src 'self' — no CDN) and fetched only
// when a message actually contains a diagram.
let mermaidModule: Promise<typeof import('mermaid')> | null = null;
function loadMermaid() {
  mermaidModule ??= import('mermaid')
    .then((mod) => {
      mod.default.initialize({
        startOnLoad: false,
        // Chat markdown is user/LLM-authored — treat diagram sources as
        // untrusted content.
        securityLevel: 'strict',
        // Without this, a parse failure strands mermaid's error-bomb SVG
        // in document.body (render() throws before its own cleanup).
        suppressErrorRendering: true,
        theme: 'dark',
        fontFamily: 'inherit',
      });
      return mod;
    })
    .catch((error) => {
      // A failed chunk load (e.g. an extension update invalidating the old
      // chunk URL) must not poison the cache — let the next diagram retry.
      mermaidModule = null;
      log.warn('Mermaid failed to load', { error });
      throw error;
    });
  return mermaidModule;
}

// Mermaid keys its body-level temp elements by render id and deletes any
// existing ones for that id, so concurrent renders (StrictMode double
// effect, chart change mid-flight) must not share an id.
let renderSeq = 0;

// Rendered SVG per chart source. Charts are deterministic strings, so a
// remount (e.g. reopening a case, which rebuilds the conversation view)
// can reuse the previous result instead of re-running parse + layout.
const svgCache = new Map<string, string>();

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
  const [state, setState] = useState<RenderState>(() => ({
    chart,
    svg: svgCache.get(chart) ?? null,
    failed: false,
  }));

  // Reset for a new chart during render so the effect stays async-only.
  if (state.chart !== chart) {
    setState({ chart, svg: svgCache.get(chart) ?? null, failed: false });
  }

  useEffect(() => {
    if (svgCache.has(chart)) return;
    let cancelled = false;
    const renderId = `mmd-${++renderSeq}`;
    loadMermaid()
      .then(({ default: mermaid }) => mermaid.render(renderId, chart))
      .then((result) => {
        if (cancelled) return;
        // Mermaid resolves with whatever survives sanitization; an empty
        // string must fall back, not sit on the loading placeholder.
        const svg = result.svg.trim() ? result.svg : null;
        if (svg) svgCache.set(chart, svg);
        setState({ chart, svg, failed: !svg });
      })
      .catch((error) => {
        log.warn('Mermaid render failed, falling back to raw source', { error });
        if (!cancelled) setState({ chart, svg: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [chart]);

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
      aria-label="Diagram"
      // Mermaid output under securityLevel 'strict' is sanitized SVG.
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  );
}
