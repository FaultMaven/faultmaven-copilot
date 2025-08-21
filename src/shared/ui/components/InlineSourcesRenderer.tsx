import React, { memo, useState } from 'react';
import { Source } from '../../../lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';

interface InlineSourcesRendererProps {
  content: string;
  sources?: Source[];
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

  return (
    <span 
      className="relative inline-block ml-1"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <sup className="text-xs text-blue-600 cursor-help hover:text-blue-800 font-medium bg-blue-50 px-1 rounded">
        [{index + 1}]
      </sup>
      
      {isHovered && (
        <div className="absolute bottom-full left-0 z-50 w-80 mb-2 p-3 bg-white border border-gray-200 rounded-lg shadow-lg">
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

const InlineSourcesRenderer: React.FC<InlineSourcesRendererProps> = memo(({ 
  content, 
  sources = [], 
  onDocumentView,
  className = '' 
}) => {
  // If no sources, render plain markdown
  if (!sources || sources.length === 0) {
    return (
      <div className={className}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={markdownComponents}
          disallowedElements={['script', 'iframe', 'object', 'embed']}
          unwrapDisallowed
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  // Split content into sentences and paragraphs for intelligent source placement
  const enhancedContent = injectSourceCitations(content, sources, onDocumentView);

  return (
    <div className={className}>
      {enhancedContent}
    </div>
  );
});

// Enhanced markdown components that support inline source citations
const markdownComponents: Partial<Components> = {
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
    <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside my-2 space-y-1">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-sm text-gray-800">{children}</li>
  ),
  p: ({ children }) => (
    <p className="text-sm text-gray-800 leading-relaxed mb-2">{children}</p>
  ),
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
};

// Function to intelligently inject source citations into content
function injectSourceCitations(
  content: string, 
  sources: Source[], 
  onDocumentView?: (documentId: string) => void
): React.ReactNode {
  // Create a closure to track citation placement
  let citationIndex = 0;
  
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        ...markdownComponents,
        // Enhance paragraph rendering to include contextual citations
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
          
          return (
            <p className="text-sm text-gray-800 leading-relaxed mb-2">
              {children}
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