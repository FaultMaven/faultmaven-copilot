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
  
  // Style headers with proper hierarchy
  h1: ({ children }) => (
    <h1 className="text-lg font-semibold text-gray-900 mt-4 mb-2">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold text-gray-900 mt-3 mb-2">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-gray-900 mt-2 mb-1">{children}</h3>
  ),
  
  // Style lists
  ul: ({ children }) => (
    <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside my-2 space-y-1">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="text-sm text-gray-800">{children}</li>
  ),
  
  // Style paragraphs
  p: ({ children }) => (
    <p className="text-sm text-gray-800 leading-relaxed mb-2">{children}</p>
  ),
  
  // Style strong/bold text
  strong: ({ children }) => (
    <strong className="font-semibold text-gray-900">{children}</strong>
  ),
  
  // Style emphasis/italic
  em: ({ children }) => (
    <em className="italic text-gray-700">{children}</em>
  ),
  
  // Style blockquotes
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-blue-200 pl-3 my-2 text-gray-700">
      {children}
    </blockquote>
  ),
  
  // Style tables (for future use)
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