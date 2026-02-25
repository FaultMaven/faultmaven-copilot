import { describe, it, expect } from 'vitest';
import {
  formatSource,
} from '../../lib/utils/response-handlers';
import {
  Source,
} from '../../lib/api';

describe('Response Handlers', () => {
  describe('formatSource', () => {
    it('formats log analysis source correctly', () => {
      const source: Source = {
        type: 'log_analysis',
        content: 'Error logs show connection timeout',
        confidence: 0.9
      };

      const result = formatSource(source);
      expect(result.emoji).toBe('📝');
      expect(result.label).toBe('Log Analysis');
      expect(result.content).toBe('Error logs show connection timeout');
      expect(result.confidence).toBe('90%');
    });

    it('formats knowledge base source correctly', () => {
      const source: Source = {
        type: 'knowledge_base',
        content: 'Database troubleshooting guide',
        confidence: 0.8
      };

      const result = formatSource(source);
      expect(result.emoji).toBe('📚');
      expect(result.label).toBe('Knowledge Base');
      expect(result.content).toBe('Database troubleshooting guide');
      expect(result.confidence).toBe('80%');
    });

    it('handles unknown source type with fallback', () => {
      const source = {
        type: 'custom_source' as any,
        content: 'Custom content',
      } as Source;

      const result = formatSource(source);
      expect(result.emoji).toBe('📄');
      expect(result.label).toBe('custom_source');
      expect(result.content).toBe('Custom content');
      expect(result.confidence).toBeUndefined();
    });
  });
});
