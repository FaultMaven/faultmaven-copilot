import { StateCreator } from 'zustand';
import { pendingOpsManager, PendingOperation } from '../../../lib/optimistic';
import { createLogger } from '../../../lib/utils/logger';

const log = createLogger('PendingOpsSlice');

interface OperationError {
  title: string;
  message: string;
  recoveryHint: string;
}

export interface PendingOpsSlice {
  pendingOperations: Record<string, PendingOperation>;

  // Actions
  setPendingOperations: (ops: Record<string, PendingOperation> | ((prev: Record<string, PendingOperation>) => Record<string, PendingOperation>)) => void;
  getFailedOperationsForUser: () => PendingOperation[];
  handleUserRetry: (operationId: string, onError: (error: any, context?: any) => void) => Promise<void>;
  handleDismissFailedOperation: (operationId: string) => void;
  getErrorMessageForOperation: (operation: PendingOperation) => OperationError;
}

export const createPendingOpsSlice: StateCreator<any, [], [], PendingOpsSlice> = (set, get) => ({
  pendingOperations: {},

  setPendingOperations: (ops) => {
    if (typeof ops === 'function') {
      set((state: any) => ({ pendingOperations: ops(state.pendingOperations) }));
    } else {
      set({ pendingOperations: ops });
    }
  },

  getFailedOperationsForUser: () => {
    const activeCaseId = get().activeCaseId;
    return pendingOpsManager.getByStatus('failed').filter(op =>
      op.type === 'create_case' && op.optimisticData?.case_id === activeCaseId ||
      op.type === 'submit_query' && op.optimisticData?.caseId === activeCaseId ||
      op.type === 'update_title' && op.optimisticData?.caseId === activeCaseId
    );
  },

  handleUserRetry: async (operationId, onError) => {
    try {
      log.info('User triggered retry', { operationId });
      await pendingOpsManager.retry(operationId);
      log.info('Retry successful', { operationId });

      set({ pendingOperations: pendingOpsManager.getAll() });
    } catch (error) {
      log.error('Retry failed', error);
      onError(error, { operation: 'retry_operation', metadata: { operationId } });
    }
  },

  handleDismissFailedOperation: (operationId) => {
    log.info('User dismissed failed operation', { operationId });
    pendingOpsManager.remove(operationId);
    set({ pendingOperations: pendingOpsManager.getAll() });
  },

  getErrorMessageForOperation: (operation) => {
    const baseError = operation.error || 'An unknown error occurred';

    switch (operation.type) {
      case 'create_case':
        return {
          title: 'Failed to Create Chat',
          message: baseError,
          recoveryHint: 'Check your internet connection and try again. If the problem persists, refresh the page.'
        };
      case 'submit_query':
        return {
          title: 'Failed to Send Message',
          message: baseError,
          recoveryHint: 'Your message was not sent. Try sending it again or check your connection.'
        };
      case 'update_title':
        return {
          title: 'Failed to Update Title',
          message: baseError,
          recoveryHint: 'The title change was not saved. You can try again or continue without changing it.'
        };
      default:
        return {
          title: 'Operation Failed',
          message: baseError,
          recoveryHint: 'Please try again or contact support if the issue persists.'
        };
    }
  }
});
