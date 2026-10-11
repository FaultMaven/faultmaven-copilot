/**
 * Text the user submits as data (the textpad, #327).
 *
 * Pasted data is evidence and is kept as the user gave it: the only thing
 * removed is blank lines around it. Leading whitespace on the first line is
 * content (YAML, an aligned table), so `String.prototype.trim` is never applied.
 */

/** Line breaks as a textarea stores them (`\r\n` and `\r` become `\n`). */
export function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Removes blank (empty or whitespace-only) leading and trailing lines, nothing else. */
export function stripBlankEdgeLines(text: string): string {
  const lines = normalizeLineBreaks(text).split('\n');
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end).join('\n');
}

/** Number of lines in `text`; an empty string has none. */
export function countLines(text: string): number {
  return text === '' ? 0 : text.split('\n').length;
}

/** `addition` on the line after `existing`, adding no blank line and dropping nothing. */
export function appendBlock(existing: string, addition: string): string {
  if (existing.trim() === '') return addition;
  return existing.endsWith('\n') ? existing + addition : `${existing}\n${addition}`;
}
