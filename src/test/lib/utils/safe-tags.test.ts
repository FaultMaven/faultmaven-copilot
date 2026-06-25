import { describe, it, expect } from 'vitest';
import { normalizeTags } from '~lib/utils/safe-tags';

describe('SafeTags (normalizeTags)', () => {
  it('should return valid arrays unchanged (fast path)', () => {
    const input = ['tag1', 'tag2'];
    const result = normalizeTags(input);
    expect(result).toEqual(['tag1', 'tag2']);
  });

  it('should filter out empty strings or non-string elements from array', () => {
    const input = ['tag1', '', '  ', null, undefined, 42, 'tag2'];
    const result = normalizeTags(input);
    expect(result).toEqual(['tag1', 'tag2']);
  });

  it('should parse comma-separated string into array (defensive path)', () => {
    const input = 'tag1, tag2 , tag3';
    const result = normalizeTags(input);
    expect(result).toEqual(['tag1', 'tag2', 'tag3']);
  });

  it('should return empty array for empty string', () => {
    const input = '   ';
    const result = normalizeTags(input);
    expect(result).toEqual([]);
  });

  it('should return empty array for null', () => {
    expect(normalizeTags(null)).toEqual([]);
  });

  it('should return empty array for undefined', () => {
    expect(normalizeTags(undefined)).toEqual([]);
  });

  it('should return empty array for other types (objects)', () => {
    expect(normalizeTags({ tags: 'a,b' })).toEqual([]);
  });
});
