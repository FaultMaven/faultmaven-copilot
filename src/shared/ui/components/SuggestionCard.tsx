import React, { useCallback, useState } from 'react';
import type { SuggestedAction, ClickableSuggestionType, QueryIntent } from '~/lib/api/types';
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
  onClickableSuggestion?: (payload: string, type: ClickableSuggestionType, intent?: QueryIntent) => void;
}

export function SuggestionCard({
  action,
  isCurrentTurn = false,
  disabled = false,
  onClickableSuggestion,
}: SuggestionCardProps) {
  const isClickableType = action.type === 'DECIDE' || action.type === 'RUN';
  const isClickable = isClickableType && isCurrentTurn && !disabled;
  const isCommand = action.type === 'RUN';
  // Phase 6 visual linkage: EVIDENCE-type suggestions that derive from a
  // persistent open need carry a backend-resolved evidence_need_id. The
  // visual signal is minimal — bullet recolored to the accent token + a
  // hover title showing the need id — so the user sees continuity across
  // turns without UI bloat. Future PRs can add dismiss / group affordances.
  const isTrackedNeed = action.type === 'EVIDENCE' && Boolean(action.evidence_need_id);
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(() => {
    // payload exists only on the clickable types (DECIDE/RUN).
    if (!isClickable || !action.payload) return;

    if (action.type === 'RUN') {
      navigator.clipboard.writeText(action.payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }

    onClickableSuggestion?.(action.payload, action.type as ClickableSuggestionType, action.intent);
  }, [isClickable, action.payload, action.type, action.intent, onClickableSuggestion]);

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
          : isClickableType && !isCurrentTurn
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
