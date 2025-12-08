/**
 * useCaseManagement Hook (v2.0 - Session-Independent Cases)
 *
 * Manages case lifecycle with frontend-only state management.
 * Updated to comply with architectural specification v2.0:
 * - Cases are session-independent resources
 * - Current case tracking is frontend state (not server)
 * - Uses /api/v1/cases with X-Session-ID header
 *
 * Key responsibilities:
 * - Lazy case creation on first action (query or upload)
 * - Frontend state management for current case
 * - Persistence across browser reloads (localStorage)
 * - Idempotent case creation (prevents duplicates)
 */

import { useState, useCallback, useRef } from 'react';
import { browser } from 'wxt/browser';
import { createLogger } from '../../../lib/utils/logger';
import { createCase, CreateCaseRequest } from '../../../lib/api';

const log = createLogger('useCaseManagement');

interface CaseManagementState {
  currentCaseId: string | null;
  isCreatingCase: boolean;
}

interface CaseCreationResponse {
  case_id: string;
  title: string;
  created_at: string;
  owner_id: string;  // v2.0: NOW REQUIRED (was session_id)
  // session_id REMOVED - cases are session-independent
}

export function useCaseManagement(sessionId: string | null) {
  const [state, setState] = useState<CaseManagementState>({
    currentCaseId: null,
    isCreatingCase: false
  });

  // Track in-flight case creation to prevent duplicate calls
  const caseCreationPromise = useRef<Promise<string> | null>(null);

  /**
   * Ensures a case exists for the current session (v2.0 - Frontend State Only).
   *
   * Flow:
   * 1. Check memory (currentCaseId state) → Return if exists
   * 2. Check localStorage (persisted across reloads) → Return if exists
   * 3. Call backend /api/v1/cases (with X-Session-ID header) → Return new ID
   *
   * This is idempotent - multiple concurrent calls return the same case_id.
   * Note: owner_id is auto-populated from session user_id by backend
   */
  const ensureCaseExists = useCallback(async (): Promise<string> => {
    // Guard: Require session
    if (!sessionId) {
      throw new Error('Cannot create case without session');
    }

    // Step 1: Check memory
    if (state.currentCaseId) {
      log.debug('Case exists in memory:', state.currentCaseId);
      return state.currentCaseId;
    }

    // Step 2: Check localStorage (survives reloads)
    try {
      const stored = await browser.storage.local.get(['faultmaven_current_case']);
      if (stored.faultmaven_current_case) {
        log.debug('Case restored from storage:', stored.faultmaven_current_case);
        setState(prev => ({ ...prev, currentCaseId: stored.faultmaven_current_case }));
        return stored.faultmaven_current_case;
      }
    } catch (error) {
      log.warn('Failed to read from storage:', error);
    }

    // Step 3: Check if case creation is already in progress
    if (caseCreationPromise.current) {
      log.debug('Case creation already in progress, waiting...');
      return await caseCreationPromise.current;
    }

    // Step 4: Create new case via backend (v2.0: uses /api/v1/cases with X-Session-ID)
    log.info('No case exists, creating new case for session:', sessionId);
    setState(prev => ({ ...prev, isCreatingCase: true }));

    const creationPromise = createNewCaseViaAPI();
    caseCreationPromise.current = creationPromise;

    try {
      const caseId = await creationPromise;

      // Persist to storage (frontend state)
      await browser.storage.local.set({ faultmaven_current_case: caseId });

      setState({
        currentCaseId: caseId,
        isCreatingCase: false
      });

      log.info('Case created successfully:', caseId);
      return caseId;
    } catch (error) {
      setState(prev => ({ ...prev, isCreatingCase: false }));
      log.error('Case creation failed:', error);
      throw error;
    } finally {
      caseCreationPromise.current = null;
    }
  }, [sessionId, state.currentCaseId]);

  /**
   * Creates a new case, forcing creation even if one exists.
   * Used when user explicitly clicks "New Chat" after using a case.
   */
  const createNewCase = useCallback(async (): Promise<string> => {
    if (!sessionId) {
      throw new Error('Cannot create case without session');
    }

    log.info('Force creating new case for session:', sessionId);
    setState(prev => ({ ...prev, isCreatingCase: true }));

    try {
      const caseId = await createNewCaseViaAPI();

      // Update state and storage (frontend state management)
      await browser.storage.local.set({ faultmaven_current_case: caseId });
      setState({
        currentCaseId: caseId,
        isCreatingCase: false
      });

      log.info('New case created successfully:', caseId);
      return caseId;
    } catch (error) {
      setState(prev => ({ ...prev, isCreatingCase: false }));
      log.error('New case creation failed:', error);
      throw error;
    }
  }, [sessionId]);

  /**
   * Sets the active case ID (used when selecting existing case from list)
   * v2.0: Frontend-only state management
   */
  const setActiveCase = useCallback(async (caseId: string | null | undefined) => {
    log.debug('Setting active case:', caseId);
    setState(prev => ({ ...prev, currentCaseId: caseId || null }));

    if (caseId) {
      await browser.storage.local.set({ faultmaven_current_case: caseId });
    } else {
      await browser.storage.local.remove(['faultmaven_current_case']);
    }
  }, []);

  /**
   * Clears the current case (used for "New Chat" button - NO backend call)
   * v2.0: Frontend-only state management
   */
  const clearCurrentCase = useCallback(async () => {
    log.debug('Clearing current case (no backend call)');
    setState(prev => ({ ...prev, currentCaseId: null }));
    await browser.storage.local.remove(['faultmaven_current_case']);
  }, []);

  return {
    currentCaseId: state.currentCaseId,
    isCreatingCase: state.isCreatingCase,
    ensureCaseExists,
    createNewCase,
    setActiveCase,
    clearCurrentCase
  };
}

/**
 * Backend API call to create a new case (v2.0 - Session-Independent)
 *
 * Uses /api/v1/cases endpoint with X-Session-ID header.
 * Owner_id is auto-populated from session user_id by backend.
 *
 * @returns Case ID (UUID from backend)
 */
async function createNewCaseViaAPI(): Promise<string> {
  log.debug('Creating new case via /api/v1/cases (v2.0)');

  // Create case with minimal data - owner_id auto-populated from session
  // Backend auto-generates title in format: Case-MMDD-N
  const request: CreateCaseRequest = {
    title: undefined,  // Let backend auto-generate
    priority: 'medium',
    metadata: {
      created_via: 'browser_extension',
      auto_generated: true
    }
  };

  // Call API (uses authenticatedFetchWithRetry with X-Session-ID header)
  const caseData = await createCase(request);

  if (!caseData.case_id) {
    throw new Error('Backend response missing case_id');
  }

  log.info('Case created via v2.0 API', { caseId: caseData.case_id });
  return caseData.case_id;
}
