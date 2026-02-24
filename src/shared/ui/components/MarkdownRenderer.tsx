import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// Memoized custom components for performance
const markdownComponents: Partial<Components> = {
  // Optimize code blocks with minimal styling
  code: ({ node, className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || '');
    const isInline = !match;
    
    if (isInline) {
      return (
        <code
          className="bg-fm-elevated text-fm-yellow px-1 py-0.5 rounded text-sm font-mono border border-fm-border"
          {...props}
        >
          {children}
        </code>
      );
    }

    return (
      <pre className="bg-fm-bg text-fm-text p-3 rounded-md overflow-x-auto my-2 border border-fm-border">
        <code className={`language-${match[1]} text-sm font-mono`} {...props}>
          {children}
        </code>
      </pre>
    );
  },
  
  // Style headers with proper hierarchy
  h1: ({ children }) => (
    <h1 className="text-lg font-semibold text-white mt-4 mb-2">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold text-white mt-3 mb-2">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-white mt-2 mb-1">{children}</h3>
  ),
  
  // Style lists
  ul: ({ children }) => (
    <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside my-2 space-y-1">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-sm text-fm-text">{children}</li>
  ),
  
  // Style paragraphs
  p: ({ children }) => (
    <p className="text-sm text-fm-text leading-relaxed mb-2">{children}</p>
  ),
  
  // Style strong/bold text
  strong: ({ children }) => (
    <strong className="font-semibold text-white">{children}</strong>
  ),
  
  // Style emphasis/italic
  em: ({ children }) => (
    <em className="italic text-fm-text">{children}</em>
  ),
  
  // Style blockquotes
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-fm-blue-border pl-3 my-2 text-fm-text">
      {children}
    </blockquote>
  ),
  
  // Style tables (for future use)
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
};

// Memoized component for maximum performance
const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(({ 
  content, 
  className = '' 
}) => {
  // Early return for empty content
  if (!content || content.length === 0) {
    return null;
  }
  
  return (
    <div className={`prose-sm max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={markdownComponents}
        // Disable HTML parsing for security (already using DOMPurify but extra safety)
        disallowedElements={['script', 'iframe', 'object', 'embed']}
        unwrapDisallowed
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';

export default MarkdownRenderer;