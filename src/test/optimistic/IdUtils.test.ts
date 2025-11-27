import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdUtils } from '../../lib/optimistic/IdUtils';

describe('IdUtils', () => {
  describe('generateChatTitle', () => {
    it('generates title in Case-MMDD-N format', () => {
      const title = IdUtils.generateChatTitle();
      expect(title).toMatch(/^Case-\d{4}-\d+$/);
    });

    it('uses current date for title', () => {
      // Mock date
      const mockDate = new Date('2024-10-28T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      const title = IdUtils.generateChatTitle();
      expect(title).toBe('Case-1028-1');

      vi.useRealTimers();
    });

    it('increments sequence number for same-day cases', () => {
      const mockDate = new Date('2024-10-28T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      const existingCases = [
        { title: 'Case-1028-1' },
        { title: 'Case-1028-2' },
        { title: 'Case-1028-3' }
      ];

      const title = IdUtils.generateChatTitle(existingCases);
      expect(title).toBe('Case-1028-4');

      vi.useRealTimers();
    });

    it('handles non-sequential existing case numbers', () => {
      const mockDate = new Date('2024-10-28T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      const existingCases = [
        { title: 'Case-1028-1' },
        { title: 'Case-1028-5' }, // Gap in sequence
        { title: 'Case-1028-3' }
      ];

      const title = IdUtils.generateChatTitle(existingCases);
      expect(title).toBe('Case-1028-6'); // Should use max + 1

      vi.useRealTimers();
    });

    it('ignores cases from different days', () => {
      const mockDate = new Date('2024-10-28T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      const existingCases = [
        { title: 'Case-1027-1' }, // Yesterday
        { title: 'Case-1027-2' },
        { title: 'Case-1029-1' }  // Tomorrow
      ];

      const title = IdUtils.generateChatTitle(existingCases);
      expect(title).toBe('Case-1028-1'); // Starts fresh for today

      vi.useRealTimers();
    });

    it('handles empty existing cases array', () => {
      const mockDate = new Date('2024-10-28T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      const title = IdUtils.generateChatTitle([]);
      expect(title).toBe('Case-1028-1');

      vi.useRealTimers();
    });

    it('handles cases with undefined titles', () => {
      const mockDate = new Date('2024-10-28T12:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      const existingCases = [
        { title: undefined },
        { title: 'Case-1028-1' },
        { title: undefined }
      ];

      const title = IdUtils.generateChatTitle(existingCases);
      expect(title).toBe('Case-1028-2');

      vi.useRealTimers();
    });
  });

  describe('isGeneratedChatTitle', () => {
    it('returns true for generated titles', () => {
      expect(IdUtils.isGeneratedChatTitle('Case-1028-1')).toBe(true);
      expect(IdUtils.isGeneratedChatTitle('Case-0101-99')).toBe(true);
      expect(IdUtils.isGeneratedChatTitle('Case-1231-1')).toBe(true);
    });

    it('returns false for user-renamed titles', () => {
      expect(IdUtils.isGeneratedChatTitle('My Custom Case')).toBe(false);
      expect(IdUtils.isGeneratedChatTitle('Debug Session')).toBe(false);
      expect(IdUtils.isGeneratedChatTitle('Production Issue Investigation')).toBe(false);
    });

    it('returns false for malformed case titles', () => {
      expect(IdUtils.isGeneratedChatTitle('Case-123-1')).toBe(false);    // Wrong date format
      expect(IdUtils.isGeneratedChatTitle('Case-12345-1')).toBe(false);  // Too many digits
      expect(IdUtils.isGeneratedChatTitle('case-1028-1')).toBe(false);   // Wrong case
      expect(IdUtils.isGeneratedChatTitle('Case-1028')).toBe(false);     // Missing number
    });
  });

  describe('extractDateFromTitle', () => {
    it('extracts date from valid generated title', () => {
      const date = IdUtils.extractDateFromTitle('Case-1028-1');

      expect(date).not.toBeNull();
      expect(date?.getMonth()).toBe(9);  // October (0-indexed)
      expect(date?.getDate()).toBe(28);
    });

    it('returns null for non-generated titles', () => {
      expect(IdUtils.extractDateFromTitle('My Custom Case')).toBeNull();
      expect(IdUtils.extractDateFromTitle('Case-invalid')).toBeNull();
    });

    it('handles January correctly', () => {
      const date = IdUtils.extractDateFromTitle('Case-0115-1');

      expect(date).not.toBeNull();
      expect(date?.getMonth()).toBe(0);  // January
      expect(date?.getDate()).toBe(15);
    });

    it('handles December correctly', () => {
      const date = IdUtils.extractDateFromTitle('Case-1231-1');

      expect(date).not.toBeNull();
      expect(date?.getMonth()).toBe(11);  // December
      expect(date?.getDate()).toBe(31);
    });
  });

  describe('generateShortId', () => {
    it('generates 8 character IDs', () => {
      const id = IdUtils.generateShortId();
      expect(id).toHaveLength(8);
    });

    it('generates alphanumeric IDs', () => {
      const id = IdUtils.generateShortId();
      expect(id).toMatch(/^[a-z0-9]+$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(IdUtils.generateShortId());
      }
      // All 100 IDs should be unique
      expect(ids.size).toBe(100);
    });
  });
});
