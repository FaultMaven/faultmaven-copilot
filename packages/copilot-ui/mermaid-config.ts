/**
 * The one definition of the mermaid site config. This package's
 * `MermaidDiagram` initializes mermaid with this object, and a host's own
 * diagram component should pass it too; the Dashboard's switches to it in
 * fm#2119 Part B.
 *
 * mermaid's site config is one global, and `setSiteConfig` resets it to the
 * defaults before applying a config, so the last initializer wins whole. Two
 * literals in one page would make the look depend on load order.
 *
 * The pre-12 layout and look pins are the owner's ruling (fm#2118, fm#2119).
 * Like `contract.ts`, it imports nothing at runtime, so a host can take it
 * without `index.ts`'s eager graph (ADR-016 D3); `mermaid-config-entry.test.ts`
 * pins that, and that the module ships.
 */
import type { MermaidConfig } from 'mermaid';

// Read-only to the type checker only: every later initializer reads this
// object. mermaid copies a config two levels deep, so its own copies share the
// nested objects here, and a runtime freeze could throw inside its merges.
export const MERMAID_CONFIG: Readonly<MermaidConfig> = {
  startOnLoad: false,
  // Chat markdown is user/LLM-authored — treat diagram sources as
  // untrusted content.
  securityLevel: 'strict',
  // Without this, a parse failure strands mermaid's error-bomb SVG
  // in document.body (render() throws before its own cleanup).
  suppressErrorRendering: true,
  theme: 'dark',
  fontFamily: 'inherit',
  // Pin the pre-12 layout and look (owner ruling, fm#2118).
  layout: 'dagre',
  look: 'classic',
  flowchart: { minNodeWidth: 0, wrappingWidth: 200 },
  state: { minNodeWidth: 0, wrappingWidth: 200 },
  // The top-level layout would otherwise replace swimlanes' and mindmaps' own (mermaid 11 ships both).
  swimlane: { layout: 'swimlane' },
  mindmap: { layout: 'cose-bilkent' },
  // Chat- or LLM-authored front matter and %%{init}%% must not pick a layout (ELK is a 1.48 MB main-thread chunk).
  secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'layout'],
};
