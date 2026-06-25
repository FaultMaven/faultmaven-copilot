/**
 * Pending Operations Hook
 *
 * Manages failed operations and retry logic using the Zustand store.
 */

import { useCallback } from 'react';
import { useAppStore } from '../../../lib/state/store';

export function usePendingOperations(
  activeCaseId: string | undefined,
  onError: (error: any, context?: any) => void
) {
  const getFailedOperationsForUser = useAppStore((state) => state.getFailedOperationsForUser);
  const handleUserRetryStore = useAppStore((state) => state.handleUserRetry);
  const handleDismissFailedOperation = useAppStore((state) => state.handleDismissFailedOperation);
  const getErrorMessageForOperation = useAppStore((state) => state.getErrorMessageForOperation);

  const handleUserRetry = useCallback((operationId: string) => {
    return handleUserRetryStore(operationId, onError);
  }, [handleUserRetryStore, onError]);

  return {
    getFailedOperationsForUser,
    handleUserRetry,
    handleDismissFailedOperation,
    getErrorMessageForOperation
  };
}
