/**
 * useCaseManagement Hook (v2.0 - Zustand Integrated)
 *
 * Exposes the active case id and its setter from the centralized Zustand store.
 */

import { useAppStore } from '../../../lib/state/store';

export function useCaseManagement() {
  const currentCaseId = useAppStore((state) => state.activeCaseId);
  const setActiveCase = useAppStore((state) => state.setActiveCaseId);

  return {
    currentCaseId,
    setActiveCase
  };
}
