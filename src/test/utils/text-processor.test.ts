// src/test/utils/text-processor.test.ts

import { describe, it, expect } from 'vitest';
import {
  cleanResponseText,
} from '../../lib/utils/text-processor';

describe('Text Processor', () => {
  describe('cleanResponseText', () => {
    it('should format PII redaction tokens correctly', () => {
      const input = 'The user with driver license <US_DRIVER_LICENSE> called from <PHONE_NUMBER>.';
      const expected = 'The user with driver license {{REDACTED:Driver License}} called from {{REDACTED:Phone Number}}.';
      expect(cleanResponseText(input)).toBe(expected);
    });

    it('should handle multiple PII token types', () => {
      const input = 'Contact: <EMAIL_ADDRESS>, Phone: <PHONE_NUMBER>, SSN: <US_SSN>';
      const output = cleanResponseText(input);

      expect(output).toContain('{{REDACTED:Email}}');
      expect(output).toContain('{{REDACTED:Phone Number}}');
      expect(output).toContain('{{REDACTED:SSN}}');
    });

    it('should remove standalone footnote markers', () => {
      const input = 'This is a response [1] with footnotes [2] that should be removed [3].';
      const output = cleanResponseText(input);

      expect(output).not.toContain('[1]');
      expect(output).not.toContain('[2]');
      expect(output).not.toContain('[3]');
      expect(output).toBe('This is a response  with footnotes  that should be removed .');
    });

    it('should normalize whitespace', () => {
      const input = 'Line 1  \n\n\n\nLine 2  \n\n\n\n\nLine 3';
      const output = cleanResponseText(input);

      // Should reduce multiple blank lines to maximum of 2
      expect(output).not.toContain('\n\n\n\n');
      expect(output.split('\n').filter(line => line === '').length).toBeLessThanOrEqual(2);
    });

    it('should handle text with no PII tokens', () => {
      const input = 'This is a normal response without any redacted content.';
      expect(cleanResponseText(input)).toBe(input);
    });

    it('should handle empty or null input', () => {
      expect(cleanResponseText('')).toBe('');
      expect(cleanResponseText(null as any)).toBe('');
      expect(cleanResponseText(undefined as any)).toBe('');
    });

    it('should handle mixed formatting issues', () => {
      const input = `
        The error occurred at <IP_ADDRESS> [1].



        User <PERSON> reported the issue [2].
        Check logs at <URL> for details [3].
      `.trim();

      const output = cleanResponseText(input);

      // Should format PII tokens
      expect(output).toContain('{{REDACTED:IP Address}}');
      expect(output).toContain('{{REDACTED:Name}}');
      expect(output).toContain('{{REDACTED:URL}}');

      // Should remove footnotes
      expect(output).not.toContain('[1]');
      expect(output).not.toContain('[2]');
      expect(output).not.toContain('[3]');

      // Should normalize whitespace
      expect(output).not.toContain('\n\n\n\n');
    });

    it('should handle bracket-style PII tokens', () => {
      const input = 'Account number: [US_BANK_NUMBER], Card: [CREDIT_CARD]';
      const output = cleanResponseText(input);

      expect(output).toContain('{{REDACTED:Bank Account}}');
      expect(output).toContain('{{REDACTED:Credit Card}}');
    });

    it('should preserve markdown formatting', () => {
      const input = '**Bold text** and *italic text* with `code` should remain.';
      const output = cleanResponseText(input);

      expect(output).toContain('**Bold text**');
      expect(output).toContain('*italic text*');
      expect(output).toContain('`code`');
    });

    it('should handle unknown PII tokens gracefully', () => {
      const input = 'Unknown token: <CUSTOM_TOKEN>';
      const output = cleanResponseText(input);

      expect(output).toContain('{{REDACTED:CUSTOM TOKEN}}');
    });
  });
});
