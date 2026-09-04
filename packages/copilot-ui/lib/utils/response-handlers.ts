import { Source } from '../api';

/**
 * Format source information with appropriate emoji
 */
export function formatSource(source: Source): {
  emoji: string;
  label: string;
  content: string;
  confidence?: string;
} {
  const sourceEmojis: Record<string, string> = {
    'log_analysis': '📝',
    'knowledge_base': '📚',
    'user_input': '👤',
    'system_metrics': '📊',
    'external_api': '🔗',
    'previous_case': '🔍'
  };

  const sourceLabels: Record<string, string> = {
    'log_analysis': 'Log Analysis',
    'knowledge_base': 'Knowledge Base',
    'user_input': 'User Input',
    'system_metrics': 'System Metrics',
    'external_api': 'External API',
    'previous_case': 'Previous Case'
  };

  const content = source.content;

  return {
    emoji: sourceEmojis[source.type] || '📄',
    label: sourceLabels[source.type] || source.type,
    content: content,
    confidence: source.confidence ? `${Math.round(source.confidence * 100)}%` : undefined
  };
}
