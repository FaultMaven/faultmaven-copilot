/**
 * useCaseManagement Hook (v2.0 - Zustand Integrated)
 *
 * Manages case lifecycle by delegating to the centralized Zustand store.
 */

import { useAppStore } from '../../../lib/state/store';

export function useCaseManagement(sessionId: string | null) {
  const currentCaseId = useAppStore((state) => state.activeCaseId);
  const isCreatingCase = useAppStore((state) => state.isCreatingCase);

  const storeEnsureCaseExists = useAppStore((state) => state.ensureCaseExists);
  const storeCreateNewCase = useAppStore((state) => state.createNewCase);
  const setActiveCase = useAppStore((state) => state.setActiveCaseId);
  const clearCurrentCase = useAppStore((state) => state.clearCurrentCase);

  const ensureCaseExists = () => storeEnsureCaseExists(sessionId);
  const createNewCase = () => storeCreateNewCase(sessionId);

  return {
    currentCaseId,
    isCreatingCase,
    ensureCaseExists,
    createNewCase,
    setActiveCase,
    clearCurrentCase
  };
}
