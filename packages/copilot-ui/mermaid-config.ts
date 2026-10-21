/**
 * The one definition of the mermaid site config. Every `initialize` in a page
 * that hosts this package passes this object: `MermaidDiagram`'s, and a host's
 * own diagram component (the Dashboard has one).
 *
 * mermaid's site config is one global, and `setSiteConfig` resets it to the
 * defaults before applying a config, so the last initializer wins whole. Two
 * literals in one page would make the look depend on load order.
 *
 * The pre-12 layout and look pins are the owner's ruling (fm#2118, fm#2119).
 * Like `contract.ts`, it imports nothing at runtime, so a host can take it
 * without `index.ts`'s eager graph (ADR-016 D3).
 */
import type { MermaidConfig } from 'mermaid';

export const MERMAID_CONFIG: MermaidConfig = {
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
