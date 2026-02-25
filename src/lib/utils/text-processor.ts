// src/lib/utils/text-processor.ts

/**
 * Text processing utilities for cleaning and formatting backend responses
 */

/**
 * PII redaction token mapping for user-friendly display
 */
const PII_TOKEN_LABELS: Record<string, string> = {
  'US_DRIVER_LICENSE': 'Driver License',
  'PHONE_NUMBER': 'Phone Number',
  'EMAIL_ADDRESS': 'Email',
  'CREDIT_CARD': 'Credit Card',
  'US_SSN': 'SSN',
  'US_PASSPORT': 'Passport',
  'IP_ADDRESS': 'IP Address',
  'PERSON': 'Name',
  'NRP': 'ID Number',
  'LOCATION': 'Location',
  'DATE_TIME': 'Date/Time',
  'URL': 'URL',
  'IBAN_CODE': 'IBAN',
  'US_BANK_NUMBER': 'Bank Account',
  'CRYPTO': 'Crypto Wallet',
  'MEDICAL_LICENSE': 'Medical License',
  'US_ITIN': 'ITIN',
};

/**
 * Cleans backend response text by:
 * - Removing or formatting PII redaction tokens
 * - Removing duplicate footnote markers
 * - Normalizing whitespace
 */
export function cleanResponseText(text: string): string {
  if (!text || typeof text !== 'string') {
    return String(text || '');
  }

  let cleaned = text;

  // Step 1: Format PII redaction tokens
  cleaned = formatPIITokens(cleaned);

  // Step 2: Remove standalone footnote markers that aren't part of citations
  // Keep footnote markers only if they're immediately followed by relevant context
  // This removes backend-generated [1], [2] markers that will be replaced by our UI citations
  cleaned = removeStandaloneFootnotes(cleaned);

  // Step 3: Break diagnostic reasoning keywords onto their own line
  cleaned = formatDiagnosticKeywords(cleaned);

  // Step 4: Normalize whitespace
  cleaned = normalizeWhitespace(cleaned);

  return cleaned;
}

/**
 * Formats PII redaction tokens to be more user-friendly
 * Converts <US_DRIVER_LICENSE> to a more readable format
 */
function formatPIITokens(text: string): string {
  // Match PII tokens in the format <TOKEN_NAME> or [TOKEN_NAME]
  const piiTokenRegex = /<([A-Z_]+)>|\[([A-Z_]+)\]/g;

  return text.replace(piiTokenRegex, (match, token1, token2) => {
    const token = token1 || token2;
    const label = PII_TOKEN_LABELS[token] || token.replace(/_/g, ' ');

    // Return a marker that will be styled in the UI
    // Using a custom format that won't interfere with markdown
    return `{{REDACTED:${label}}}`;
  });
}

/**
 * Removes standalone footnote markers [1], [2], etc. that appear in the text
 * These are typically from backend formatting and should be replaced by our UI citations
 */
function removeStandaloneFootnotes(text: string): string {
  // Remove footnote markers that appear alone (not part of a longer citation)
  // Match [1], [2], etc. but not [some text with 1] or [citation]
  return text.replace(/\[(\d+)\]/g, '');
}

/**
 * Formats diagnostic reasoning keywords (OBSERVATION, ANALYSIS, SUGGESTION, EXPECTED OUTCOME)
 * so the keyword sits on its own line and the paragraph starts on the next line.
 * Handles both plain and bold-wrapped variants (e.g. **OBSERVATION:** or OBSERVATION:).
 */
function formatDiagnosticKeywords(text: string): string {
  // Match keyword at start of line, optionally bold-wrapped, followed by text on the same line.
  // [\*:]+ handles all colon/bold orderings: "KEYWORD:", "**KEYWORD:**", "**KEYWORD**:"
  return text.replace(
    /^\*{0,2}(OBSERVATION|ANALYSIS|SUGGESTION|EXPECTED OUTCOME)[\*:]+[ \t]+(.+)$/gm,
    (_, keyword, rest) => {
      return `**${keyword}:**\n${rest}`;
    }
  );
}

/**
 * Normalizes whitespace:
 * - Removes multiple consecutive blank lines (keep max 2)
 * - Trims trailing whitespace from lines
 * - Ensures consistent line breaks
 */
function normalizeWhitespace(text: string): string {
  return text
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
