import React, { memo, useMemo } from 'react';
import { Source } from '../../../lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { cleanResponseText } from '../../../lib/utils/text-processor';
import { formatSource } from '../../../lib/utils/response-handlers';
import { ConfirmationButtons } from './ConfirmationButtons';
import { MermaidDiagram } from './MermaidDiagram';

interface InlineSourcesRendererProps {
  content: string;
  sources?: Source[];
  onDocumentView?: (documentId: string) => void;
  onConfirmationYes?: () => void;
  onConfirmationNo?: () => void;
  className?: string;
}

interface SourcesInContextProps {
  sources: Source[];
  onDocumentView?: (documentId: string) => void;
}

/**
 * The runbooks the KB pre-fetch put in the model's context for this turn.
 *
 * Turn-level on purpose. `TurnResponse.sources` says which runbooks the model
 * had in front of it, not which sentence each one informed, so a marker pinned
 * to a paragraph would claim a provenance the data does not carry. A native
 * `<details>` keeps the list reachable by keyboard and touch, and every source
 * is listed, whatever shape the reply takes. The turn paths set `sources` only
 * where that context arrives or changes (`lib/state/turn-sources`).
 */
const SourcesInContext: React.FC<SourcesInContextProps> = memo(({ sources, onDocumentView }) => (
  <details className="mt-2 text-xs text-fm-text-tertiary">
    <summary className="cursor-pointer select-none hover:text-fm-text-secondary">
      📚 {sources.length === 1 ? '1 runbook' : `${sources.length} runbooks`} in context
    </summary>
    <ul className="mt-2 space-y-2">
      {sources.map((source, index) => (
        <SourceEntry
          key={`${index}-${sourceDocumentId(source) ?? ''}`}
          source={source}
          index={index}
          onDocumentView={onDocumentView}
        />
      ))}
    </ul>
  </details>
));

SourcesInContext.displayName = 'SourcesInContext';

/** `metadata` is an open object in the contract; read a key only when it is a non-empty string. */
function metadataString(source: Source, key: string): string | null {
  const value = source.metadata?.[key];
  return typeof value === 'string' && value ? value : null;
}

function sourceDocumentId(source: Source): string | null {
  return source.type === 'knowledge_base' ? metadataString(source, 'document_id') : null;
}

interface SourceEntryProps {
  source: Source;
  index: number;
  onDocumentView?: (documentId: string) => void;
}

const SourceEntry: React.FC<SourceEntryProps> = memo(({ source, index, onDocumentView }) => {
  const { emoji, label, confidence } = formatSource(source);
  const title = metadataString(source, 'title') ?? `Source ${index + 1}`;
  const documentId = sourceDocumentId(source);

  return (
    <li className="rounded-md border border-fm-border bg-fm-surface p-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium text-fm-text-primary">{title}</span>
        <span>{emoji} {label}</span>
        {confidence && <span className="font-mono">{confidence} relevance</span>}
        {source.verification_status && <span>· {source.verification_status}</span>}
      </div>
      {source.content && (
        <p className="mt-1 text-fm-text-secondary leading-relaxed">{source.content}</p>
      )}
      {documentId && onDocumentView && (
        <button
          type="button"
          onClick={() => onDocumentView(documentId)}
          className="mt-1 font-medium text-fm-accent hover:underline"
        >
          Open runbook →
        </button>
      )}
    </li>
  );
});

SourceEntry.displayName = 'SourceEntry';

interface PIIBadgeProps {
  label: string;
}

const PIIBadge: React.FC<PIIBadgeProps> = memo(({ label }) => {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 text-xs font-medium bg-fm-surface text-fm-text-secondary border border-fm-border rounded-md opacity-80"
      title={`This information has been redacted for privacy: ${label}`}
    >
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
      </svg>
      REDACTED: {label}
    </span>
  );
});

PIIBadge.displayName = 'PIIBadge';

/**
 * Detects if content contains confirmation button pattern
 * Pattern: [✅ Yes]  [❌ No]
 */
function hasConfirmationButtons(text: string): boolean {
  const buttonPattern = /\[✅\s*Yes\]\s*\[❌\s*No\]/;
  return buttonPattern.test(text);
}

/**
 * Strips confirmation button pattern from content
 */
function stripConfirmationButtons(text: string): string {
  const buttonPattern = /\[✅\s*Yes\]\s*\[❌\s*No\]/g;
  return text.replace(buttonPattern, '').trim();
}

/**
 * Process text to replace PII token markers with React components
 */
function processPIITokens(text: string): React.ReactNode[] {
  const piiTokenRegex = /\{\{REDACTED:([^}]+)\}\}/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;
  let keyCounter = 0;

  while ((match = piiTokenRegex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    // Add PII badge
    parts.push(<PIIBadge key={`pii-${keyCounter++}`} label={match[1]} />);

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

/**
 * Helper to extract raw text from React nodes
 */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node) && node.props && 'children' in (node.props as any)) {
    return extractText((node.props as any).children as React.ReactNode);
  }
  return '';
}

/**
 * Helper to recursively process PII tokens while preserving React elements
 */
function processChildrenForPII(children: React.ReactNode): React.ReactNode {
  if (typeof children === 'string') {
    if (children.includes('{{REDACTED:')) {
      return processPIITokens(children);
    }
    return children;
  }

  if (Array.isArray(children)) {
    return React.Children.map(children, child => processChildrenForPII(child));
  }

  if (React.isValidElement(children)) {
    if (children.props && 'children' in (children.props as any)) {
      return React.cloneElement(children as React.ReactElement<any>, {
        ...(children.props as object),
        children: processChildrenForPII((children.props as any).children as React.ReactNode)
      });
    }
  }

  return children;
}

const InlineSourcesRenderer: React.FC<InlineSourcesRendererProps> = memo(({
  content,
  sources = [],
  onDocumentView,
  onConfirmationYes,
  onConfirmationNo,
  className = ''
}) => {
  // Clean the response text before rendering
  const cleanedContent = useMemo(() => cleanResponseText(content), [content]);

  // Detect and strip confirmation buttons
  const hasButtons = useMemo(() => hasConfirmationButtons(cleanedContent), [cleanedContent]);
  const contentWithoutButtons = useMemo(() =>
    hasButtons ? stripConfirmationButtons(cleanedContent) : cleanedContent,
    [cleanedContent, hasButtons]
  );

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
        disallowedElements={DISALLOWED_ELEMENTS}
        unwrapDisallowed
      >
        {contentWithoutButtons}
      </ReactMarkdown>

      {/* Render confirmation buttons if detected */}
      {hasButtons && onConfirmationYes && onConfirmationNo && (
        <ConfirmationButtons
          onConfirm={onConfirmationYes}
          onCancel={onConfirmationNo}
        />
      )}

      {sources.length > 0 && <SourcesInContext sources={sources} onDocumentView={onDocumentView} />}
    </div>
  );
});

/**
 * Creates enhanced markdown components with PII token handling
 */
function createMarkdownComponents(): Partial<Components> {
  return {
    code: ({ className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || '');
      const isInline = !match;

      if (isInline) {
        return (
          <code
            className="bg-fm-code-bg text-fm-code px-1 py-0.5 rounded text-[0.9em] font-mono border border-fm-code-border"
            {...props}
          >
            {children}
          </code>
        );
      }

      // Mermaid fences (e.g. the Causal Map embedded in the closure-turn
      // resolution summary) render as diagrams, not source text.
      if (match[1] === 'mermaid') {
        return <MermaidDiagram chart={extractText(children).trim()} />;
      }

      return (
        <pre className="bg-fm-codeblock text-fm-codeblock-text p-3 rounded-md overflow-x-auto my-2 border border-fm-codeblock-border">
          <code className={`language-${match[1]} text-xs font-mono`} {...props}>
            {children}
          </code>
        </pre>
      );
    },
    // Unwrap the markdown <pre> around a routed diagram (the code renderer
    // above already returns a block-level element for every fenced case).
    // The child here is an element of the custom `code` component that has
    // not run yet, so detect mermaid by the fence className, not the type.
    pre: ({ node, children, ...props }) => {
      const child = Array.isArray(children) ? children[0] : children;
      if (
        React.isValidElement(child) &&
        /\blanguage-mermaid\b/.test((child.props as { className?: string }).className ?? '')
      ) {
        return <>{children}</>;
      }
      return <pre {...props}>{children}</pre>;
    },
    h1: ({ children }) => (
      <h1 className="text-lg font-semibold mt-4 mb-2">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-base font-semibold mt-3 mb-2">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>
    ),
    ul: ({ children }) => (
      <ul className="list-disc list-outside my-2 space-y-1 pl-5">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-outside my-2 space-y-1 pl-5">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="text-sm text-fm-text-secondary">{children}</li>
    ),
    p: ({ children }) => {
      // Process PII tokens in paragraph text while preserving React elements
      const textContent = extractText(children);
      let processedChildren: React.ReactNode = children;

      if (textContent.includes('{{REDACTED:')) {
        processedChildren = processChildrenForPII(children);
      }

      return (
        <p className="text-sm text-fm-text-secondary leading-relaxed mb-2">
          {processedChildren}
        </p>
      );
    },
    strong: ({ children }) => (
      <strong className="font-semibold">{children}</strong>
    ),
    em: ({ children }) => (
      <em className="italic text-fm-text-primary">{children}</em>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-fm-accent-border pl-3 my-2 text-fm-text-primary">
        {children}
      </blockquote>
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto my-2">
        <table className="min-w-full border-collapse border border-fm-border text-sm">
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-fm-border bg-fm-bg px-2 py-1 font-medium text-left">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-fm-border px-2 py-1">{children}</td>
    ),
    // Add text node processor to handle PII tokens in any text content
    text: ({ children }) => {
      const textContent = extractText(children);
      if (textContent.includes('{{REDACTED:')) {
        return <>{processChildrenForPII(children)}</>;
      }
      return <>{children}</>;
    },
  };
}

// Built once. react-markdown uses each entry as an element TYPE, so a fresh
// function per render makes React unmount and remount every paragraph, code
// block and Mermaid diagram of every message on each re-render.
const MARKDOWN_COMPONENTS = createMarkdownComponents();
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];
const DISALLOWED_ELEMENTS = ['script', 'iframe', 'object', 'embed'];

InlineSourcesRenderer.displayName = 'InlineSourcesRenderer';

export default InlineSourcesRenderer;