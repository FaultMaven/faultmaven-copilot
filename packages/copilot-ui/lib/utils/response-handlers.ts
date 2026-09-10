import { Source, SourceType } from '../api';

/**
 * Format source information with appropriate emoji
 *
 * Both maps are keyed by the PUBLISHED `SourceType` (contract 3.3.0) and typed
 * `Record<SourceType, ...>`, so a value the server adds cannot be rendered
 * without a label being written for it here.
 */
export function formatSource(source: Source): {
  emoji: string;
  label: string;
  content: string;
  confidence?: string;
} {
  const sourceEmojis: Record<SourceType, string> = {
    'documentation': '📖',
    'knowledge_base': '📚',
    'log_file': '📝',
    'previous_analysis': '🔍',
    'user_provided': '👤',
    'web_search': '🌐'
  };

  const sourceLabels: Record<SourceType, string> = {
    'documentation': 'Documentation',
    'knowledge_base': 'Knowledge Base',
    'log_file': 'Log File',
    'previous_analysis': 'Previous Analysis',
    'user_provided': 'User Provided',
    'web_search': 'Web Search'
  };

  const content = source.content;

  return {
    emoji: sourceEmojis[source.type] ?? '📄',
    label: sourceLabels[source.type] ?? source.type,
    content: content,
    confidence: source.confidence ? `${Math.round(source.confidence * 100)}%` : undefined
  };
}
