import React, { useCallback, useId, useState } from 'react';
import type { SuggestedAction, ClickableSuggestionType, SuggestionIntent } from '../../../lib/api/types';
import { opensDataBox } from '../../../lib/state/turn-items';

// =============================================================================
// Public Interface
// =============================================================================

export interface SuggestionCardProps {
  action: SuggestedAction;
  /** Whether this suggestion belongs to the current (latest) turn */
  isCurrentTurn?: boolean;
  disabled?: boolean;
  onClickableSuggestion?: (payload: string, type: ClickableSuggestionType, intent?: SuggestionIntent) => void;
  /**
   * Opens the composer's data box holding `prefill`, `hint` (the action's
   * `body`) as its placeholder; sends nothing (#328). Absent where the composer
   * takes no data (a closed case, a read-only viewer): the data-box action is
   * then informational, like any other EVIDENCE.
   */
  onOpenDataBox?: (prefill: string, hint: string | undefined) => void;
  /**
   * The composer cannot take data right now (a turn or a page capture in
   * flight): the data-box action is shown as a disabled button rather than
   * offering a click that would do nothing. Other types are unaffected.
   */
  dataBoxBusy?: boolean;
}

/** What the data-box action says it does, beside its label. */
const OPENS_DATA_BOX = 'opens Paste data';

export function SuggestionCard({
  action,
  isCurrentTurn = false,
  disabled = false,
  onClickableSuggestion,
  onOpenDataBox,
  dataBoxBusy = false,
}: SuggestionCardProps) {
  // Clickable by name: every other type, including UNRECOGNIZED, is plain text,
  // except the data-box action (an EVIDENCE carrying `prefill`) where the
  // composer can take data.
  const clickableType: ClickableSuggestionType | null =
    action.type === 'DECIDE' || action.type === 'RUN' ? action.type : null;
  const opensBox = opensDataBox(action) && onOpenDataBox !== undefined;
  const isClickableType = clickableType !== null || opensBox;
  // Offered but unavailable: the data box opens only once the composer is idle.
  const isWaiting = opensBox && isCurrentTurn && !disabled && dataBoxBusy;
  const isClickable = isClickableType && isCurrentTurn && !disabled && !isWaiting;
  const isCommand = clickableType === 'RUN';
  const bodyId = useId();
  // Phase 6 visual linkage: EVIDENCE-type suggestions that derive from a
  // persistent open need carry a backend-resolved evidence_need_id. The
  // visual signal is minimal — bullet recolored to the accent token + a
  // hover title showing the need id — so the user sees continuity across
  // turns without UI bloat. Future PRs can add dismiss / group affordances.
  const isTrackedNeed = action.type === 'EVIDENCE' && Boolean(action.evidence_need_id);
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(() => {
    if (!isClickable) return;
    // Nothing is sent: the user corrects what the box holds and sends it.
    if (opensBox) {
      onOpenDataBox?.(action.prefill ?? '', action.body);
      return;
    }
    // payload exists only on the clickable types (DECIDE/RUN).
    if (clickableType === null || !action.payload) return;

    if (clickableType === 'RUN') {
      navigator.clipboard.writeText(action.payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }

    onClickableSuggestion?.(action.payload, clickableType, action.intent);
  }, [isClickable, opensBox, clickableType, action.payload, action.prefill, action.body, action.intent, onClickableSuggestion, onOpenDataBox]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && isClickable) {
      e.preventDefault();
      handleClick();
    }
  }, [isClickable, handleClick]);

  // A DECIDE sends and the data-box action does not, so their accessible names
  // differ: the latter says what it opens, and its body describes it.
  const isDataBoxControl = opensBox && (isClickable || isWaiting);
  const accessibleName = isDataBoxControl
    ? `${action.label} (${OPENS_DATA_BOX})`
    : isClickable
      ? action.label
      : undefined;

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
          : isWaiting || (isClickableType && !isCurrentTurn)
            ? 'opacity-50'
            : ''
      }`}
      onClick={isClickable ? handleClick : undefined}
      onKeyDown={isClickable ? handleKeyDown : undefined}
      role={isClickable || isWaiting ? 'button' : undefined}
      tabIndex={isClickable ? 0 : isWaiting ? -1 : undefined}
      aria-disabled={isWaiting ? true : undefined}
      aria-label={accessibleName}
      aria-describedby={isDataBoxControl && suffix ? bodyId : undefined}
      title={
        isWaiting
          ? 'Available once the message being sent has gone'
          : isTrackedNeed
            ? `Tracks an open data need (id: ${action.evidence_need_id})`
            : undefined
      }
      data-evidence-need-id={isTrackedNeed ? action.evidence_need_id : undefined}
      data-suggestion-type={action.type}
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
          <span className="text-fm-xs text-fm-text-tertiary leading-snug"> — <span id={bodyId}>{suffix}</span></span>
        )}
        {isCommand && isCurrentTurn && (
          <span className="ml-1.5 text-fm-xs text-fm-text-tertiary leading-snug">
            {copied ? '✓ Copied — paste in terminal' : '(click to copy command)'}
          </span>
        )}
        {isDataBoxControl && (
          <span className="ml-1.5 text-fm-xs text-fm-text-tertiary leading-snug">({OPENS_DATA_BOX})</span>
        )}
      </div>
    </div>
  );
}
