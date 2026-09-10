import { describe, it, expect } from 'vitest';
import {
  formatSource,
} from '@faultmaven/copilot-ui/lib/utils/response-handlers';
import {
  Source,
  SourceType,
} from '@faultmaven/copilot-ui/lib/api';

describe('Response Handlers', () => {
  describe('formatSource', () => {
    it('formats a log-file source correctly', () => {
      const source: Source = {
        type: 'log_file',
        content: 'Error logs show connection timeout',
        confidence: 0.9
      };

      const result = formatSource(source);
      expect(result.emoji).toBe('📝');
      expect(result.label).toBe('Log File');
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

    // The property, not one instance: every member of the PUBLISHED SourceType
    // (contract 3.3.0) must render a label of its own. A value the server adds
    // later fails this the moment the regenerated union carries it, which is
    // the point of keying the maps on the union rather than on `string`.
    it('labels every published SourceType without falling back', () => {
      const published: SourceType[] = [
        'documentation',
        'knowledge_base',
        'log_file',
        'previous_analysis',
        'user_provided',
        'web_search',
      ];

      for (const type of published) {
        const result = formatSource({ type, content: 'x' });
        expect(result.emoji).not.toBe('📄');
        expect(result.label).not.toBe(type);
      }
    });

    // The retired union's own values are no longer published, so they take the
    // unknown-value path exactly like any other slug this client does not know.
    it('falls back for a value the contract does not publish', () => {
      const source = {
        type: 'log_analysis',
        content: 'Custom content',
      } as unknown as Source;

      const result = formatSource(source);
      expect(result.emoji).toBe('📄');
      expect(result.label).toBe('log_analysis');
      expect(result.content).toBe('Custom content');
      expect(result.confidence).toBeUndefined();
    });
  });
});
