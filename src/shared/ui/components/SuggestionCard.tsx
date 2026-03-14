import React, { useCallback } from 'react';
import type { SuggestedAction, CooperativeAction } from '~/lib/api/types';
import { createLogger } from '~/lib/utils/logger';

const log = createLogger('SuggestionCard');

// =============================================================================
// Public Interface
// =============================================================================

export interface SuggestionCardProps {
  action: SuggestedAction;
  /** Whether this suggestion belongs to the current (latest) turn */
  isCurrentTurn?: boolean;
  disabled?: boolean;
  onCooperativeClick?: (payload: string, cooperativeAction: CooperativeAction) => void;
}

export function SuggestionCard({
  action,
  isCurrentTurn = false,
  disabled = false,
  onCooperativeClick,
}: SuggestionCardProps) {
  const isClickable = action.type === 'COOPERATIVE' && isCurrentTurn && !disabled;

  const handleClick = useCallback(() => {
    if (!isClickable) return;
    const cooperativeAction = action.cooperative_action ?? 'query_submit';

    if (cooperativeAction === 'command_copy') {
      navigator.clipboard.writeText(action.payload);
    }

    onCooperativeClick?.(action.payload, cooperativeAction);
  }, [isClickable, action.payload, action.cooperative_action, onCooperativeClick]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && isClickable) {
      e.preventDefault();
      handleClick();
    }
  }, [isClickable, handleClick]);

  const isCommand = action.type === 'COOPERATIVE' && action.cooperative_action === 'command_copy';

  // Suffix text: body, payload description, or hints depending on type
  const suffix = action.type === 'FREE_SPEECH'
    ? action.hints && action.hints.length > 0
      ? action.hints.join(' · ')
      : null
    : action.body || null;

  return (
    <div
      className={`flex items-baseline gap-2 py-0.5 ${
        isClickable
          ? 'cursor-pointer group'
          : action.type === 'COOPERATIVE' && !isCurrentTurn
            ? 'opacity-50'
            : ''
      }`}
      onClick={isClickable ? handleClick : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      aria-label={isClickable ? action.label : undefined}
    >
      <span className="text-fm-xs text-fm-text-tertiary select-none flex-shrink-0">•</span>
      <div className="flex-1 min-w-0">
        <span className={`text-fm-xs font-medium ${
          isClickable
            ? 'text-fm-accent group-hover:underline'
            : 'text-fm-text-primary'
        }`}>
          {action.label}
        </span>
        {suffix && (
          <span className="text-fm-xs text-fm-text-tertiary"> — {suffix}</span>
        )}
        {isCommand && isCurrentTurn && (
          <span className="ml-1.5 text-fm-xs text-fm-text-tertiary">(copies command)</span>
        )}
      </div>
    </div>
  );
}
