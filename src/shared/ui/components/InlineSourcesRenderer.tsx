import React, { memo, useState, useMemo, useRef, useEffect } from 'react';
import { Source, EvidenceRequest } from '../../../lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { cleanResponseText } from '../../../lib/utils/text-processor';
import EvidenceRequestCard from './EvidenceRequestCard';

interface InlineSourcesRendererProps {
  content: string;
  sources?: Source[];
  evidenceRequests?: EvidenceRequest[];
  onDocumentView?: (documentId: string) => void;
  className?: string;
}

interface SourceCitationProps {
  source: Source;
  index: number;
  onDocumentView?: (documentId: string) => void;
}

const SourceCitation: React.FC<SourceCitationProps> = memo(({ source, index, onDocumentView }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<'left' | 'right'>('left');
  const tooltipRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  // Get source content (handle both content and snippet fields)
  const sourceContent = source.content || (source as any).snippet || 'No preview available';
  const sourceTitle = source.metadata?.title || (source as any).name || `Source ${index + 1}`;

  // Extract document ID for viewing
  const documentId = source.type === 'knowledge_base' && source.metadata?.document_id
    ? source.metadata.document_id
    : null;

  // Truncate content for preview
  const preview = sourceContent.length > 100
    ? sourceContent.substring(0, 100) + "..."
    : sourceContent;

  // Calculate optimal tooltip position to prevent viewport overflow
  useEffect(() => {
    if (isHovered && tooltipRef.current && triggerRef.current) {
      const tooltip = tooltipRef.current;
      const trigger = triggerRef.current;
      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const viewportWidth = window.innerWidth;

      // Calculate if tooltip would overflow on the right side
      // Add 20px buffer from viewport edge
      const wouldOverflowRight = triggerRect.left + tooltipRect.width > viewportWidth - 20;

      // Calculate if we have enough space on the left
      const hasSpaceOnLeft = triggerRect.right - tooltipRect.width > 20;

      // Position to the right (align right edge to trigger) if would overflow and has space on left
      if (wouldOverflowRight && hasSpaceOnLeft) {
        setTooltipPosition('right');
      } else {
        setTooltipPosition('left');
      }
    }
  }, [isHovered]);

  return (
    <span
      ref={triggerRef}
      className="relative inline-block ml-1"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <sup className="text-xs text-blue-600 cursor-help hover:text-blue-800 font-medium bg-blue-50 px-1 rounded">
        [{index + 1}]
      </sup>

      {isHovered && (
        <div
          ref={tooltipRef}
          className={`absolute bottom-full z-50 w-80 mb-2 p-3 bg-white border border-gray-200 rounded-lg shadow-lg ${
            tooltipPosition === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-medium text-gray-900 truncate">
                {sourceTitle}
              </span>
              <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full flex-shrink-0">
                {source.type === 'knowledge_base' ? '📚' : '📄'} {source.type.replace('_', ' ')}
              </span>
            </div>
          </div>

          <div className="text-xs text-gray-700 leading-relaxed mb-3">
            <div className="bg-gray-50 rounded p-2 border-l-2 border-blue-200">
              {preview}
            </div>
          </div>

          {documentId && onDocumentView && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDocumentView(documentId);
                setIsHovered(false);
              }}
              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
            >
              View full document →
            </button>
          )}
        </div>
      )}
    </span>
  );
});

SourceCitation.displayName = 'SourceCitation';

/**
 * PII Badge Component - Renders redacted PII tokens as styled badges
 */
interface PIIBadgeProps {
  label: string;
}

const PIIBadge: React.FC<PIIBadgeProps> = memo(({ label }) => {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-300 rounded-md"
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

const InlineSourcesRenderer: React.FC<InlineSourcesRendererProps> = memo(({
  content,
  sources = [],
  evidenceRequests = [],
  onDocumentView,
  className = ''
}) => {
  // Clean the response text before rendering
  const cleanedContent = useMemo(() => cleanResponseText(content), [content]);

  // If no sources, render plain markdown with PII handling
  if (!sources || sources.length === 0) {
    return (
      <div className={className}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={createMarkdownComponents()}
          disallowedElements={['script', 'iframe', 'object', 'embed']}
          unwrapDisallowed
        >
          {cleanedContent}
        </ReactMarkdown>

        {/* Render evidence requests below content */}
        {evidenceRequests && evidenceRequests.length > 0 && (
          <div className="mt-4 space-y-3">
            <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
              Evidence Requested
            </div>
            {evidenceRequests.map((request) => (
              <EvidenceRequestCard
                key={request.request_id}
                request={request}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Split content into sentences and paragraphs for intelligent source placement
  const enhancedContent = injectSourceCitations(cleanedContent, sources, onDocumentView);

  return (
    <div className={className}>
      {enhancedContent}

      {/* Render evidence requests below content and sources */}
      {evidenceRequests && evidenceRequests.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
            Evidence Requested
          </div>
          {evidenceRequests.map((request) => (
            <EvidenceRequestCard
              key={request.request_id}
              request={request}
            />
          ))}
        </div>
      )}
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
            className="bg-gray-100 text-red-600 px-1 py-0.5 rounded text-sm font-mono"
            {...props}
          >
            {children}
          </code>
        );
      }

      return (
        <pre className="bg-gray-900 text-gray-100 p-3 rounded-md overflow-x-auto my-2">
          <code className={`language-${match[1]} text-sm`} {...props}>
            {children}
          </code>
        </pre>
      );
    },
    h1: ({ children }) => (
      <h1 className="text-lg font-semibold text-gray-900 mt-4 mb-2">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-base font-semibold text-gray-900 mt-3 mb-2">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-sm font-semibold text-gray-900 mt-2 mb-1">{children}</h3>
    ),
    ul: ({ children }) => (
      <ul className="list-disc list-outside my-2 space-y-1 pl-5">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-outside my-2 space-y-1 pl-5">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="text-sm text-gray-800">{children}</li>
    ),
    p: ({ children }) => {
      // Process PII tokens in paragraph text
      const textContent = String(children);
      if (textContent.includes('{{REDACTED:')) {
        const processedChildren = processPIITokens(textContent);
        return (
          <p className="text-sm text-gray-800 leading-relaxed mb-2">
            {processedChildren}
          </p>
        );
      }
      return (
        <p className="text-sm text-gray-800 leading-relaxed mb-2">{children}</p>
      );
    },
    strong: ({ children }) => (
      <strong className="font-semibold text-gray-900">{children}</strong>
    ),
    em: ({ children }) => (
      <em className="italic text-gray-700">{children}</em>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-blue-200 pl-3 my-2 text-gray-700">
        {children}
      </blockquote>
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto my-2">
        <table className="min-w-full border-collapse border border-gray-200 text-sm">
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-gray-200 bg-gray-50 px-2 py-1 font-medium text-left">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-gray-200 px-2 py-1">{children}</td>
    ),
    // Add text node processor to handle PII tokens in any text content
    text: ({ children }) => {
      const textContent = String(children);
      if (textContent.includes('{{REDACTED:')) {
        return <>{processPIITokens(textContent)}</>;
      }
      return <>{children}</>;
    },
  };
}

// Function to intelligently inject source citations into content
function injectSourceCitations(
  content: string,
  sources: Source[],
  onDocumentView?: (documentId: string) => void
): React.ReactNode {
  // Create a closure to track citation placement
  let citationIndex = 0;

  // Get base markdown components
  const baseComponents = createMarkdownComponents();

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        ...baseComponents,
        // Enhance paragraph rendering to include contextual citations AND PII handling
        p: ({ children }) => {
          const textContent = String(children);
          const shouldHaveCitation = textContent.length > 40 &&
                                   sources.length > 0 &&
                                   citationIndex < sources.length &&
                                   (textContent.includes('based on') ||
                                    textContent.includes('according to') ||
                                    textContent.includes('documentation') ||
                                    textContent.includes('shows') ||
                                    textContent.includes('indicates') ||
                                    textContent.toLowerCase().includes('error') ||
                                    textContent.toLowerCase().includes('issue') ||
                                    textContent.toLowerCase().includes('problem') ||
                                    citationIndex === 0); // Always cite first substantive paragraph

          let citation = null;
          if (shouldHaveCitation) {
            citation = (
              <SourceCitation
                source={sources[citationIndex]}
                index={citationIndex}
                onDocumentView={onDocumentView}
              />
            );
            citationIndex++;
          }

          // Process PII tokens in paragraph text
          let processedChildren: React.ReactNode = children;
          if (textContent.includes('{{REDACTED:')) {
            processedChildren = processPIITokens(textContent);
          }

          return (
            <p className="text-sm text-gray-800 leading-relaxed mb-2">
              {processedChildren}
              {citation}
            </p>
          );
        }
      }}
      disallowedElements={['script', 'iframe', 'object', 'embed']}
      unwrapDisallowed
    >
      {content}
    </ReactMarkdown>
  );
}

InlineSourcesRenderer.displayName = 'InlineSourcesRenderer';

export default InlineSourcesRenderer;