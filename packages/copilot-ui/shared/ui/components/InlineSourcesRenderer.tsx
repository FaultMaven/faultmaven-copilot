import React, { memo, useMemo } from 'react';
import { Source } from '../../../lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { cleanResponseText } from '../../../lib/utils/text-processor';
import { formatSource } from '../../../lib/utils/response-handlers';
import { isRestrictedSource, RESTRICTED_SOURCE_LABEL } from '../../../lib/state/turn-sources';
import { MermaidDiagram } from './MermaidDiagram';

interface InlineSourcesRendererProps {
  content: string;
  sources?: Source[];
  onDocumentView?: (documentId: string) => void;
  className?: string;
}

interface SourcesInContextProps {
  sources: Source[];
  onDocumentView?: (documentId: string) => void;
}

/**
 * The runbook sections this turn's prompt carried.
 *
 * Turn-level on purpose. `TurnResponse.sources` says which runbooks the model
 * had in front of it, not which sentence each one informed, so a marker pinned
 * to a paragraph would claim a provenance the data does not carry. A native
 * `<details>` keeps the list reachable by keyboard and touch, and every source
 * is listed, whatever shape the reply takes. The turn paths set `sources` only
 * where something in it is new (`lib/state/turn-sources`).
 *
 * The list comes from three channels (`metadata.trigger`, `sourceGroup`), and
 * a turn can carry several: the standing pre-fetched context beside what a
 * question lookup or the assistant's own search found for this turn. Each
 * channel is its own group, so the answer to a question is never read as the
 * standing context or the reverse. Group labels appear only when more than
 * one group is present; they are labelled groups, not headings, so a card adds
 * nothing to the reply's outline.
 *
 * The count is of runbooks, not entries: a runbook can contribute two
 * sections (`runbookCount`).
 */
const SourcesInContext: React.FC<SourcesInContextProps> = memo(({ sources, onDocumentView }) => {
  const groups = useMemo(() => groupSources(sources), [sources]);
  const count = useMemo(() => runbookCount(sources), [sources]);
  return (
    <details className="mt-2 text-xs text-fm-text-tertiary">
      <summary className="cursor-pointer select-none hover:text-fm-text-secondary">
        📚 {count === 1 ? '1 runbook' : `${count} runbooks`} in context
      </summary>
      {groups.map(({ group, entries }) => (
        <div
          key={group}
          className="mt-2"
          role="group"
          aria-label={groups.length > 1 ? SOURCE_GROUP_HEADINGS[group] : undefined}
        >
          {groups.length > 1 && (
            <p aria-hidden="true" className="mb-1 font-medium text-fm-text-secondary">
              {SOURCE_GROUP_HEADINGS[group]}
            </p>
          )}
          <ul className="space-y-2">
            {entries.map(({ source, index, number }) => (
              <SourceEntry
                key={`${index}-${sourceDocumentId(source) ?? ''}`}
                source={source}
                number={number}
                onDocumentView={onDocumentView}
              />
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
});

SourcesInContext.displayName = 'SourcesInContext';

/**
 * Which channel put a source in the prompt.
 *
 * - `question`: the lookup run for the user's question about the knowledge base
 *   (contract 14.24.0);
 * - `kb_qa`: a section the assistant's own knowledge-base search answered from;
 * - `case`: the pre-fetch for the case's problem (`symptom`) or its remediation
 *   (`root_cause`), which stands in every prompt until it is replaced — and any
 *   trigger this client does not know, which a server can only have added as
 *   another kind of context;
 * - `restricted`: a runbook the viewer may not open. The server strips its
 *   metadata to `{"access": "restricted"}`, trigger included, so which channel
 *   carried it is not known here.
 */
type SourceGroup = 'question' | 'kb_qa' | 'case' | 'restricted';

/** Listed in this order: what answers this turn first. */
const SOURCE_GROUP_ORDER: readonly SourceGroup[] = ['question', 'kb_qa', 'case', 'restricted'];

const SOURCE_GROUP_HEADINGS: Record<SourceGroup, string> = {
  question: 'Found for your question',
  kb_qa: "From the assistant's knowledge-base search",
  case: 'Matched to this case',
  restricted: "Runbooks you don't have access to",
};

function sourceGroup(source: Source): SourceGroup {
  if (isRestrictedSource(source)) return 'restricted';
  const trigger = metadataString(source, 'trigger');
  return trigger === 'question' || trigger === 'kb_qa' ? trigger : 'case';
}

interface IndexedSource {
  source: Source;
  /** Position in the turn's list (the React key). */
  index: number;
  /**
   * 1-based position among the entries the card shows a title for, in display
   * order: the "Source N" fallback counts down the card as the reader sees it,
   * with no gap where a redacted entry or another group sits.
   */
  number: number;
}

function groupSources(sources: Source[]): { group: SourceGroup; entries: IndexedSource[] }[] {
  const byGroup = new Map<SourceGroup, Omit<IndexedSource, 'number'>[]>();
  sources.forEach((source, index) => {
    const group = sourceGroup(source);
    byGroup.set(group, [...(byGroup.get(group) ?? []), { source, index }]);
  });
  let shown = 0;
  return SOURCE_GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => ({
    group,
    entries: (byGroup.get(group) ?? []).map((entry) => ({
      ...entry,
      number: group === 'restricted' ? 0 : ++shown,
    })),
  }));
}

/**
 * How many runbooks the list names: entries sharing a `document_id` are
 * sections of one runbook. An entry with no id — a redacted one, or one whose
 * metadata is missing — cannot be matched to another and counts as its own,
 * so two redacted sections of one runbook count as two.
 */
function runbookCount(sources: Source[]): number {
  const ids = new Set<string>();
  let unmatched = 0;
  for (const source of sources) {
    const id = isRestrictedSource(source) ? null : sourceDocumentId(source);
    if (id) ids.add(id);
    else unmatched += 1;
  }
  return ids.size + unmatched;
}

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
  /** The "Source N" fallback's N (`IndexedSource.number`). */
  number: number;
  onDocumentView?: (documentId: string) => void;
}

const SourceEntry: React.FC<SourceEntryProps> = memo(({ source, number, onDocumentView }) => {
  // Redacted for this viewer: it names no runbook, so no "Source N", no link
  // and no preview — only that the model had one this viewer cannot open.
  // Returned before any metadata is read, so a stray title or document id on
  // a restricted entry is never shown or linked.
  if (isRestrictedSource(source)) {
    return (
      <li className="rounded-md border border-fm-border bg-fm-surface p-2 italic text-fm-text-tertiary">
        {RESTRICTED_SOURCE_LABEL}
      </li>
    );
  }
  const { emoji, label, confidence } = formatSource(source);
  const title = metadataString(source, 'title') ?? `Source ${number}`;
  const documentId = sourceDocumentId(source);

  return (
    <li className="rounded-md border border-fm-border bg-fm-surface p-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium text-fm-text-primary">{title}</span>
        <span>{emoji} {label}</span>
        {confidence && <span className="font-mono">{confidence} relevance</span>}
        {source.verification_status && <span>· {source.verification_status}</span>}
      </div>
      {source.content && <SourceExcerpt content={source.content} />}
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

/**
 * A runbook section's excerpt, rendered as the markdown it is.
 *
 * Runbooks are markdown and the excerpt is the head of a section, so it
 * routinely opens with the section's own heading and carries bold labels,
 * lists and inline code. Headings are demoted to bold lines: an excerpt sits
 * inside a list item and is not part of the reply's outline. The server cuts
 * an excerpt at a character count, so a construct can be left open (a code
 * fence, a backtick); markdown renders that as text rather than failing.
 *
 * A link opens in a new tab, and only when it is absolute http(s): the card
 * lives in the extension's side panel and in the Dashboard's page, and a
 * followed link would replace either — losing the conversation — while a
 * relative one resolves against the host, not the runbook, so it renders as
 * its text. Images are dropped: the card previews text, and an image URL in a
 * runbook would be fetched by every viewer who opens the card.
 */
const SourceExcerpt: React.FC<{ content: string }> = memo(({ content }) => (
  <div className="mt-1 text-fm-text-secondary leading-relaxed">
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      components={EXCERPT_COMPONENTS}
      disallowedElements={EXCERPT_DISALLOWED_ELEMENTS}
      unwrapDisallowed
    >
      {content}
    </ReactMarkdown>
  </div>
));

SourceExcerpt.displayName = 'SourceExcerpt';

/** The reply's disallowed elements, and images (`SourceExcerpt`). */
const EXCERPT_DISALLOWED_ELEMENTS = ['script', 'iframe', 'object', 'embed', 'img'];

const excerptHeading: Components['h1'] = ({ children }) => (
  <p className="font-semibold text-fm-text-primary">{children}</p>
);

// Compact on purpose: the card is `text-xs`, and the reply's own components
// (`MARKDOWN_COMPONENTS`) size headings and paragraphs for the reply.
const EXCERPT_COMPONENTS: Partial<Components> = {
  h1: excerptHeading,
  h2: excerptHeading,
  h3: excerptHeading,
  h4: excerptHeading,
  h5: excerptHeading,
  h6: excerptHeading,
  p: ({ children }) => <p className="my-1">{children}</p>,
  ul: ({ children }) => <ul className="list-disc list-outside my-1 space-y-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-outside my-1 space-y-0.5 pl-4">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold text-fm-text-primary">{children}</strong>,
  code: ({ children }) => (
    <code className="bg-fm-code-bg text-fm-code px-1 rounded font-mono border border-fm-code-border">
      {children}
    </code>
  ),
  a: ({ href, children }) =>
    href && /^https?:\/\//i.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-fm-accent hover:underline">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  table: ({ children }) => (
    <div className="my-1 overflow-x-auto">
      <table className="border-collapse border border-fm-border">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-fm-border px-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border border-fm-border px-1">{children}</td>,
  // A fenced block reaches `code` too (react-markdown passes no inline flag);
  // the block's box is the `pre`, so its `code` drops the inline chip styling.
  pre: ({ children }) => (
    <pre className="my-1 overflow-x-auto rounded border border-fm-border bg-fm-bg p-2 [&>code]:border-0 [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
};

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
  className = ''
}) => {
  // Clean the response text before rendering. A reply is rendered as written:
  // no text in it becomes a control. A confirmation is answered only through
  // the card the server attaches (`SuggestionCard`), whose intent names the
  // offer it presents; a button drawn from a pattern in the text could name
  // none, and the server refuses such a click (#291, faultmaven#1812).
  const cleanedContent = useMemo(() => cleanResponseText(content), [content]);

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
        disallowedElements={DISALLOWED_ELEMENTS}
        unwrapDisallowed
      >
        {cleanedContent}
      </ReactMarkdown>

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