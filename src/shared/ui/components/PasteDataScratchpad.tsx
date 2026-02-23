/**
 * Paste Data Scratchpad Component
 *
 * Staging area for pasting data (logs, configs, error traces) to attach
 * alongside a query. Data is staged locally and submitted with the main
 * Send button via the unified /turns endpoint.
 */

import React, { useState, useRef, useEffect } from 'react';

export interface PasteDataScratchpadProps {
  initialContent?: string;
  onStage: (content: string) => void;
  onClear: () => void;
  onClose: () => void;
}

export function PasteDataScratchpad({
  initialContent = '',
  onStage,
  onClear,
  onClose,
}: PasteDataScratchpadProps) {
  const [pastedContent, setPastedContent] = useState(initialContent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleDone = () => {
    if (pastedContent.trim()) {
      onStage(pastedContent.trim());
    }
    onClose();
  };

  const handleClear = () => {
    setPastedContent('');
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
      className="border border-purple-200 bg-purple-50 rounded-lg p-3 space-y-2"
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-purple-700">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Paste Data
        </div>
        <button
          onClick={handleDone}
          className="text-purple-400 hover:text-purple-600 transition-colors"
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
        onChange={(e) => setPastedContent(e.target.value)}
        placeholder="Paste logs, error traces, configs, or any data here..."
        rows={6}
        className="block w-full p-2 text-xs font-mono border border-purple-200 rounded resize-y focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
        aria-label="Paste data content"
      />

      {/* Footer with stats and actions */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-purple-500">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'} &middot; {charCount.toLocaleString()} chars
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Ctrl+Enter to attach</span>
          <button
            type="button"
            onClick={handleClear}
            className="px-3 py-1.5 text-xs font-medium text-purple-600 bg-white border border-purple-200 rounded hover:bg-purple-100 transition-colors"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={handleDone}
            disabled={!pastedContent.trim()}
            className="px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded hover:bg-purple-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
