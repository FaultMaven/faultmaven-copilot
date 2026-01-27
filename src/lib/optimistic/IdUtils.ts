/**
 * IdUtils - Utility functions for ID and title generation
 *
 * **IMPORTANT**: Title generation is primarily a BACKEND responsibility per API contract.
 * Backend auto-generates titles in Case-MMDD-N format when not provided.
 * Frontend methods here are for OPTIMISTIC UI display only.
 *
 * Example: Case-1028-1, Case-1028-2
 */

interface CaseWithTitle {
  title?: string;
}

export class IdUtils {
  /**
   * Generate a unique case title in format: Case-MMDD-N for OPTIMISTIC UI DISPLAY ONLY.
   *
   * **IMPORTANT**: Backend is the authoritative source for case titles per API contract
   * (openapi.locked.yaml:5909). Backend auto-generates titles when not provided.
   *
   * This method is ONLY used for:
   * - Optimistic UI updates while case creation is in-flight
   * - Display purposes before backend response arrives
   *
   * Backend-provided titles ALWAYS take precedence over optimistic titles.
   *
   * Example: Case-1028-1, Case-1028-2, Case-1028-3
   *
   * @param existingCases - Optional list of existing cases for determining sequence number
   * @returns Case title like "Case-1028-1" (for optimistic display only)
   */
  static generateChatTitle(existingCases?: CaseWithTitle[]): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${month}${day}`;

    // Find existing cases with same date prefix
    const todayCases = (existingCases || []).filter(c =>
      c.title && c.title.startsWith(`Case-${datePrefix}-`)
    );

    // Extract numbers and find max
    const numbers = todayCases.map(c => {
      const match = c.title?.match(/Case-\d{4}-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    });

    const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;

    return `Case-${datePrefix}-${nextNumber}`;
  }

  /**
   * Check if a title is a generated case title (vs user-renamed)
   * Generated titles match: Case-MMDD-N
   */
  static isGeneratedChatTitle(title: string): boolean {
    return /^Case-\d{4}-\d+$/.test(title);
  }

  /**
   * Extract date from case title
   * Returns Date object if title matches Case-MMDD-N format
   */
  static extractDateFromTitle(title: string): Date | null {
    const match = title.match(/^Case-(\d{2})(\d{2})-\d+$/);
    if (!match) return null;

    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    const year = new Date().getFullYear();

    try {
      return new Date(year, month - 1, day);
    } catch {
      return null;
    }
  }

  /**
   * Generate a short unique ID (8 characters)
   * Useful for operation tracking
   */
  static generateShortId(): string {
    return Math.random().toString(36).substring(2, 10);
  }
}