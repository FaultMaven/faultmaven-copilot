/**
 * OptimisticIdGenerator - Generates unique IDs for optimistic updates
 *
 * Provides consistent ID generation for optimistic operations before
 * real backend IDs are available.
 */

export class OptimisticIdGenerator {
  private static caseCounter = 0;
  private static messageCounter = 0;
  private static genericCounter = 0;

  /**
   * Generate a unique optimistic case ID
   * Format: opt_case_<timestamp>_<counter>
   */
  static generateCaseId(): string {
    this.caseCounter++;
    const timestamp = Date.now();
    return `opt_case_${timestamp}_${this.caseCounter}`;
  }

  /**
   * Generate a unique optimistic message ID
   * Format: opt_msg_<timestamp>_<counter>
   */
  static generateMessageId(): string {
    this.messageCounter++;
    const timestamp = Date.now();
    return `opt_msg_${timestamp}_${this.messageCounter}`;
  }

  /**
   * Check if an ID is optimistic (starts with opt_)
   */
  static isOptimistic(id: string): boolean {
    return id.startsWith('opt_');
  }

  /**
   * Check if an ID is an optimistic case ID
   */
  static isOptimisticCase(id: string): boolean {
    return id.startsWith('opt_case_');
  }

  /**
   * Check if an ID is an optimistic message ID
   */
  static isOptimisticMessage(id: string): boolean {
    return id.startsWith('opt_msg_');
  }

  /**
   * Generic generate method (backward compatibility)
   *
   * FIXED: Now uses incrementing counter instead of Math.random()
   * to prevent ID collision risk
   */
  static generate(prefix: string): string {
    if (prefix === 'opt_case') return this.generateCaseId();
    if (prefix === 'opt_msg') return this.generateMessageId();

    // Default implementation for unknown prefixes
    // Uses incrementing counter to guarantee uniqueness
    this.genericCounter++;
    const timestamp = Date.now();
    return `${prefix}_${timestamp}_${this.genericCounter}`;
  }

  /**
   * Reset counters (useful for testing)
   */
  static resetCounters(): void {
    this.caseCounter = 0;
    this.messageCounter = 0;
    this.genericCounter = 0;
  }
}