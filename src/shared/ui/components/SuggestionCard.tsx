import React, { useCallback, useState } from 'react';
import type { SuggestedAction, CooperativeAction, QueryIntent } from '~/lib/api/types';
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
  onCooperativeClick?: (payload: string, cooperativeAction: CooperativeAction, intent?: QueryIntent) => void;
}

export function SuggestionCard({
  action,
  isCurrentTurn = false,
  disabled = false,
  onCooperativeClick,
}: SuggestionCardProps) {
  const isClickable = action.type === 'COOPERATIVE' && isCurrentTurn && !disabled;
  const isCommand = action.type === 'COOPERATIVE' && action.cooperative_action === 'command_copy';
  // Phase 6 visual linkage: EVIDENCE-type suggestions that derive from a
  // persistent open need carry a backend-resolved evidence_need_id. The
  // visual signal is minimal — bullet recolored to the accent token + a
  // hover title showing the need id — so the user sees continuity across
  // turns without UI bloat. Future PRs can add dismiss / group affordances.
  const isTrackedNeed = action.type === 'EVIDENCE' && Boolean(action.evidence_need_id);
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(() => {
    // payload is COOPERATIVE-only; a clickable suggestion always carries one.
    if (!isClickable || !action.payload) return;
    const cooperativeAction = action.cooperative_action ?? 'query_submit';

    if (cooperativeAction === 'command_copy') {
      navigator.clipboard.writeText(action.payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }

    onCooperativeClick?.(action.payload, cooperativeAction, action.intent);
  }, [isClickable, action.payload, action.cooperative_action, action.intent, onCooperativeClick]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && isClickable) {
      e.preventDefault();
      handleClick();
    }
  }, [isClickable, handleClick]);

  // Suffix text: body, payload description, or hints depending on type
  const suffix = action.type === 'FREE_SPEECH'
    ? action.hints && action.hints.length > 0
      ? action.hints.join(' · ')
      : null
    : action.body || null;

  return (
    <div
      className={`flex items-baseline gap-1.5 py-px leading-snug ${
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
      title={isTrackedNeed ? `Tracks open evidence need (id: ${action.evidence_need_id})` : undefined}
      data-evidence-need-id={isTrackedNeed ? action.evidence_need_id : undefined}
    >
      <span
        className={`text-fm-xs select-none flex-shrink-0 leading-snug ${
          isTrackedNeed ? 'text-fm-accent' : 'text-fm-text-tertiary'
        }`}
      >
        •
      </span>
      <div className="flex-1 min-w-0">
        <span className={`text-fm-xs font-medium leading-snug ${
          isClickable
            ? 'text-fm-accent group-hover:underline'
            : 'text-fm-text-primary'
        }`}>
          {action.label}
        </span>
        {suffix && (
          <span className="text-fm-xs text-fm-text-tertiary leading-snug"> — {suffix}</span>
        )}
        {isCommand && isCurrentTurn && (
          <span className="ml-1.5 text-fm-xs text-fm-text-tertiary leading-snug">
            {copied ? '✓ Copied — paste in terminal' : '(click to copy command)'}
          </span>
        )}
      </div>
    </div>
  );
}
