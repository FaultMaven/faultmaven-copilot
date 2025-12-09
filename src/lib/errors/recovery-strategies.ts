
import { RecoveryStrategy, UserFacingError } from './types';
import { ErrorClassifier } from './classifier';

export interface RecoveryAction {
  label: string;
  action: () => Promise<void> | void;
  isPrimary?: boolean;
}

export interface RecoveryPlan {
  strategy: RecoveryStrategy;
  actions: RecoveryAction[];
  autoRetry?: boolean;
  retryDelay?: number;
}

/**
 * Determines the actionable plan for a given error based on its recovery strategy
 */
export function getRecoveryPlan(
  error: unknown,
  callbacks: {
    onRetry: () => void | Promise<void>;
    onLogout?: () => void | Promise<void>;
    onClearInput?: () => void;
  }
): RecoveryPlan {
  const userError = ErrorClassifier.classify(error);
  const strategy = userError.recovery;

  const plan: RecoveryPlan = {
    strategy,
    actions: []
  };

  switch (strategy) {
    case 'retry_with_backoff':
    case 'auto_retry_with_delay':
      plan.autoRetry = true;
      plan.retryDelay = (userError as any).retryAfterMs || 1000;
      plan.actions.push({
        label: 'Retry Now',
        action: callbacks.onRetry,
        isPrimary: true
      });
      break;

    case 'manual_retry':
    case 'rollback_and_retry':
      plan.actions.push({
        label: 'Retry',
        action: callbacks.onRetry,
        isPrimary: true
      });
      break;

    case 'logout_and_redirect':
      plan.actions.push({
        label: 'Sign In',
        action: callbacks.onLogout || (() => Promise.resolve()),
        isPrimary: true
      });
      break;

    case 'user_fix_required':
      if (callbacks.onClearInput) {
        plan.actions.push({
          label: 'Clear Input',
          action: callbacks.onClearInput
        });
      }
      break;

    case 'show_modal':
    case 'graceful_degradation':
    default:
      // No specific default actions
      break;
  }

  return plan;
}
