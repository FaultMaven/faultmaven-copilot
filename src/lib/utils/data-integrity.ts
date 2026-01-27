/**
 * Data Integrity Utilities for Optimistic Updates
 *
 * This module implements strict data separation between optimistic and real data
 * to prevent contamination issues in the optimistic updates system.
 *
 * Architectural Principles:
 * 1. Never mix optimistic and real data in the same data structures
 * 2. Validate data at all boundaries
 * 3. Use type system to enforce separation
 * 4. Fail fast on architecture violations
 */

import { UserCase } from '../api';
import { OptimisticUserCase } from '../optimistic/types';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('DataIntegrity');

// ============================================================================
// Type Definitions for Strict Data Separation
// ============================================================================

export interface RealCase extends UserCase {
  source: 'backend';
  case_id: string; // Never starts with 'opt_'
}

export interface OptimisticCase extends UserCase {
  source: 'optimistic';
  case_id: string; // Always starts with 'opt_'
  pendingOperationId: string;
  optimistic: true;
}

export type ValidatedCase = RealCase | OptimisticCase;

// ============================================================================
// ID Format Validation
// ============================================================================

/**
 * Check if an ID is optimistic format
 */
export const isOptimisticId = (id: string): boolean => {
  return typeof id === 'string' && id.startsWith('opt_');
};

/**
 * Check if an ID is real (backend) format
 */
export const isRealId = (id: string): boolean => {
  return typeof id === 'string' && !id.startsWith('opt_');
};

/**
 * Validate optimistic ID format
 */
export const validateOptimisticId = (id: string): void => {
  if (!isOptimisticId(id)) {
    throw new Error(`ARCHITECTURE VIOLATION: Expected optimistic ID (opt_*), got: ${id}`);
  }
};

/**
 * Validate real ID format
 */
export const validateRealId = (id: string): void => {
  if (!isRealId(id)) {
    throw new Error(`ARCHITECTURE VIOLATION: Expected real ID (not opt_*), got: ${id}`);
  }
};

// ============================================================================
// Data Sanitization Functions
// ============================================================================

/**
 * Extract ONLY real cases from mixed data
 * Logs violations and filters out contamination
 */
export const sanitizeBackendCases = (cases: UserCase[], context: string = 'unknown'): RealCase[] => {
  if (!Array.isArray(cases)) {
    console.warn(`[DataIntegrity] Invalid cases array in ${context}:`, cases);
    return [];
  }

  const realCases: RealCase[] = [];
  const contaminatedCases: UserCase[] = [];

  cases.forEach(caseItem => {
    if (!caseItem || !caseItem.case_id) {
      console.warn(`[DataIntegrity] Invalid case in ${context}:`, caseItem);
      return;
    }

    if (isRealId(caseItem.case_id)) {
      realCases.push({
        ...caseItem,
        source: 'backend'
      } as RealCase);
    } else if (isOptimisticId(caseItem.case_id)) {
      contaminatedCases.push(caseItem);
    } else {
      console.warn(`[DataIntegrity] Unknown ID format in ${context}: ${caseItem.case_id}`);
    }
  });

  // Log contamination violations
  if (contaminatedCases.length > 0) {
    console.error(`[DataIntegrity] ARCHITECTURE VIOLATION in ${context}: Optimistic IDs found in backend data:`,
      contaminatedCases.map(c => c.case_id));
  }

  return realCases;
};

/**
 * Extract ONLY optimistic cases from mixed data
 * Logs violations and filters out contamination
 * v2.0: Updated to accept OptimisticUserCase[] (which extends UserCase with owner_id)
 */
export const sanitizeOptimisticCases = (cases: OptimisticUserCase[], context: string = 'unknown'): OptimisticCase[] => {
  if (!Array.isArray(cases)) {
    console.warn(`[DataIntegrity] Invalid cases array in ${context}:`, cases);
    return [];
  }

  const optimisticCases: OptimisticCase[] = [];
  const contaminatedCases: OptimisticUserCase[] = [];  // v2.0: Allow Optional owner_id

  cases.forEach(caseItem => {
    if (!caseItem || !caseItem.case_id) {
      console.warn(`[DataIntegrity] Invalid case in ${context}:`, caseItem);
      return;
    }

    if (isOptimisticId(caseItem.case_id)) {
      optimisticCases.push({
        ...caseItem,
        source: 'optimistic',
        optimistic: true,
        pendingOperationId: caseItem.case_id // Use case ID as operation ID for now
      } as OptimisticCase);
    } else if (isRealId(caseItem.case_id)) {
      contaminatedCases.push(caseItem);
    } else {
      console.warn(`[DataIntegrity] Unknown ID format in ${context}: ${caseItem.case_id}`);
    }
  });

  // Log contamination violations
  if (contaminatedCases.length > 0) {
    console.error(`[DataIntegrity] ARCHITECTURE VIOLATION in ${context}: Real IDs found in optimistic data:`,
      contaminatedCases.map(c => c.case_id));
  }

  return optimisticCases;
};

// ============================================================================
// Safe Merging Functions
// ============================================================================

export interface MergeResult {
  cases: ValidatedCase[];
  realCount: number;
  optimisticCount: number;
  violations: string[];
}

/**
 * Safely merge optimistic and real cases with strict separation
 * v2.0: Updated to accept OptimisticUserCase[] (which extends UserCase with owner_id)
 */
export const mergeOptimisticAndReal = (
  backendCases: UserCase[],
  optimisticCases: OptimisticUserCase[],
  context: string = 'unknown'
): MergeResult => {
  const violations: string[] = [];

  // Sanitize inputs with violation tracking
  const realCases = sanitizeBackendCases(backendCases, `${context}:backend`);
  const optCases = sanitizeOptimisticCases(optimisticCases, `${context}:optimistic`);

  // Build merge map with real cases taking precedence
  const mergedMap = new Map<string, ValidatedCase>();

  // Add real cases first (they have precedence)
  realCases.forEach(realCase => {
    mergedMap.set(realCase.case_id, realCase);
  });

  // Add optimistic cases only if no real case exists with same ID
  optCases.forEach(optCase => {
    if (!mergedMap.has(optCase.case_id)) {
      mergedMap.set(optCase.case_id, optCase);
    } else {
      violations.push(`Optimistic case ${optCase.case_id} conflicts with real case`);
    }
  });

  // Convert to sorted array
  const mergedCases = Array.from(mergedMap.values());
  mergedCases.sort((a, b) => {
    const aTime = new Date(b.updated_at || b.created_at || 0).getTime();
    const bTime = new Date(a.updated_at || a.created_at || 0).getTime();
    return aTime - bTime;
  });

  // Log violations
  if (violations.length > 0) {
    console.warn(`[DataIntegrity] Merge violations in ${context}:`, violations);
  }

  return {
    cases: mergedCases,
    realCount: realCases.length,
    optimisticCount: optCases.length,
    violations
  };
};

// ============================================================================
// State Validation Functions
// ============================================================================

/**
 * Validate state integrity across the application
 * v2.0: Updated to accept OptimisticUserCase[] (which extends UserCase with owner_id)
 */
export const validateStateIntegrity = (state: {
  conversations?: Record<string, any[]>;
  conversationTitles?: Record<string, string>;
  optimisticCases?: OptimisticUserCase[];
}, context: string = 'unknown'): boolean => {
  let isValid = true;
  const violations: string[] = [];

  // Check for mixed IDs in conversations
  if (state.conversations) {
    Object.keys(state.conversations).forEach(caseId => {
      if (isOptimisticId(caseId) && isRealId(caseId)) {
        violations.push(`Mixed ID format in conversations: ${caseId}`);
        isValid = false;
      }
    });
  }

  // Check for mixed IDs in conversation titles
  if (state.conversationTitles) {
    Object.keys(state.conversationTitles).forEach(caseId => {
      if (isOptimisticId(caseId) && isRealId(caseId)) {
        violations.push(`Mixed ID format in titles: ${caseId}`);
        isValid = false;
      }
    });
  }

  // Check optimistic cases format
  if (state.optimisticCases) {
    state.optimisticCases.forEach(optCase => {
      if (optCase.case_id && isRealId(optCase.case_id)) {
        violations.push(`Real ID in optimistic cases: ${optCase.case_id}`);
        isValid = false;
      }
    });
  }

  if (!isValid) {
    console.error(`[DataIntegrity] State integrity violations in ${context}:`, violations);
  }

  return isValid;
};

// ============================================================================
// Development Utilities
// ============================================================================

/**
 * Debug utility to inspect data separation
 */
export const debugDataSeparation = (data: any, label: string = 'Unknown') => {
  if (Array.isArray(data)) {
    const realIds = data.filter(item => item?.case_id && isRealId(item.case_id));
    const optIds = data.filter(item => item?.case_id && isOptimisticId(item.case_id));
    const invalidIds = data.filter(item => item?.case_id && !isRealId(item.case_id) && !isOptimisticId(item.case_id));

    log.debug(`Debug ${label}`, {
      realIds: realIds.map(item => item.case_id),
      optimisticIds: optIds.map(item => item.case_id),
      invalidIds: invalidIds.length > 0 ? invalidIds.map(item => item.case_id) : undefined
    });

    if (invalidIds.length > 0) {
      log.warn(`Invalid IDs found in ${label}`, { invalidIds: invalidIds.map(item => item.case_id) });
    }
  } else if (typeof data === 'object' && data !== null) {
    const realIds = Object.keys(data).filter(isRealId);
    const optIds = Object.keys(data).filter(isOptimisticId);
    const invalidIds = Object.keys(data).filter(id => !isRealId(id) && !isOptimisticId(id));

    log.debug(`Debug ${label}`, {
      realIds,
      optimisticIds: optIds,
      invalidIds: invalidIds.length > 0 ? invalidIds : undefined
    });

    if (invalidIds.length > 0) {
      log.warn(`Invalid IDs found in ${label}`, { invalidIds });
    }
  }
};