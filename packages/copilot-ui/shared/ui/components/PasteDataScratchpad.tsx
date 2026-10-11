/**
 * Paste Data Scratchpad Component
 *
 * Staging area for pasting data (logs, configs, error traces) to attach
 * alongside a query. Data is staged locally and submitted with the main
 * Send button via the unified /turns endpoint.
 *
 * Controlled: the composer owns the text, because a multi-line paste into the
 * chat box lands here while it is open, and Send carries what it holds (#327).
 */

import React, { useRef, useEffect } from 'react';
import { stripBlankEdgeLines } from '../../../lib/utils/pasted-data';

export interface PasteDataScratchpadProps {
  value: string;
  onChange: (value: string) => void;
  /** Receives the text verbatim, less blank leading and trailing lines; empty means none. */
  onStage: (content: string) => void;
  onClear: () => void;
  onClose: () => void;
  /** The placeholder while empty: the output an offer asked for (#328). */
  hint?: string;
  /** Each change moves focus into the textarea (an offer opening it again, #328). */
  focusSignal?: number;
}

export function PasteDataScratchpad({
  value: pastedContent,
  onChange,
  onStage,
  onClear,
  onClose,
  hint,
  focusSignal = 0,
}: PasteDataScratchpadProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea on mount, and again whenever the composer asks.
  useEffect(() => {
    textareaRef.current?.focus();
  }, [focusSignal]);

  const handleDone = () => {
    // Not `trim()`: the first line's indentation is part of the data. What the
    // textpad shows IS the paste, so an emptied textpad stages none.
    onStage(stripBlankEdgeLines(pastedContent));
    onClose();
  };

  const handleClear = () => {
    onChange('');
    onClear();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl/Cmd+Enter to stage and close
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleDone();
    }
    // Escape to close (auto-stages if content exists)
    if (e.key === 'Escape') {
      handleDone();
    }
  };

  const lineCount = pastedContent.split('\n').length;
  const charCount = pastedContent.length;

  return (
    <div
      className="border border-fm-accent-border bg-fm-accent-soft rounded-lg p-3 space-y-2"
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-fm-accent">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Paste Data
        </div>
        <button
          onClick={handleDone}
          className="text-fm-accent hover:text-fm-accent transition-colors"
          aria-label="Close paste scratchpad"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Data textarea */}
      <textarea
        ref={textareaRef}
        value={pastedContent}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint ?? "Paste logs, error traces, configs, or any data here..."}
        rows={6}
        className="block w-full p-2 text-xs font-mono border border-fm-accent-border rounded resize-y focus:outline-none focus:ring-2 focus:ring-fm-accent bg-fm-surface"
        aria-label="Paste data content"
      />

      {/* Footer with stats and actions */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-fm-accent">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'} &middot; {charCount.toLocaleString()} chars
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fm-text-secondary">Ctrl+Enter to attach</span>
          <button
            type="button"
            onClick={handleClear}
            className="px-3 py-1.5 text-xs font-medium text-fm-accent bg-fm-surface border border-fm-accent-border rounded hover:bg-fm-accent-soft transition-colors"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={handleDone}
            disabled={!pastedContent.trim()}
            className="px-3 py-1.5 text-xs font-medium text-white bg-fm-accent rounded hover:opacity-90 transition-colors disabled:bg-fm-elevated disabled:cursor-not-allowed"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
