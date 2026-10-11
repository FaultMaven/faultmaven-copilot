/**
 * `holdsBlock`: whether the textpad already holds an offered block (#328, #345
 * review). Whole lines only: a substring match let a held `max: 100` swallow an
 * offered one-line `max: 10`, and the user never saw the block they were asked
 * to correct.
 */
import { describe, it, expect } from 'vitest';
import { holdsBlock } from '@faultmaven/copilot-ui/lib/utils/pasted-data';

describe('holdsBlock', () => {
  it('matches a block on consecutive whole lines', () => {
    expect(holdsBlock('intro\nERROR a\nERROR b\nend', 'ERROR a\nERROR b')).toBe(true);
    expect(holdsBlock('ERROR a', 'ERROR a')).toBe(true);
  });

  it('never matches inside a line', () => {
    expect(holdsBlock('max: 100', 'max: 10')).toBe(false);
    expect(holdsBlock('  max: 10', 'max: 10')).toBe(false);
  });

  it('needs the lines in order and adjacent', () => {
    expect(holdsBlock('ERROR a\nother\nERROR b', 'ERROR a\nERROR b')).toBe(false);
    expect(holdsBlock('ERROR b\nERROR a', 'ERROR a\nERROR b')).toBe(false);
  });

  it('treats \\r\\n as \\n, and an empty block as held', () => {
    expect(holdsBlock('a\r\nb', 'a\nb')).toBe(true);
    expect(holdsBlock('', '')).toBe(true);
    expect(holdsBlock('', 'a')).toBe(false);
  });
});
