/**
 * Unified Input Bar Component
 *
 * Smart input component with a single Send button for all turn content:
 * - Query text (typed in textarea)
 * - Pasted data (staged via scratchpad)
 * - File uploads
 * - Captured page content
 *
 * Any combination can be submitted together in a single turn.
 * Query-only submissions use the optimistic UI path (onQuerySubmit).
 * Submissions with attachments use the unified turn path (onTurnSubmit).
 */

import React, { useState, useRef, useEffect } from 'react';
import { browser } from 'wxt/browser';
import { createLogger } from '~/lib/utils/logger';
import { PasteDataScratchpad } from './PasteDataScratchpad';

const log = createLogger('UnifiedInputBar');
import { INPUT_LIMITS } from '../layouts/constants';

/**
 * Payload for submissions with attachments (files, pasted data, page content).
 * Sent via the unified /turns endpoint.
 */
export interface TurnPayload {
  query?: string;
  pastedContent?: string;
  files?: File[];
}

export interface UnifiedInputBarProps {
  // State
  disabled?: boolean;
  loading?: boolean;
  submitting?: boolean;

  // Callbacks
  onQuerySubmit: (query: string) => void;
  onTurnSubmit: (payload: TurnPayload) => Promise<{ success: boolean; message: string }>;
  onPageInject?: () => Promise<string>;

  // Configuration
  maxLength?: number;
  placeholder?: string;
}

/**
 * Input modes based on content detection
 */
type InputMode = 'question' | 'data';

/**
 * Validation error state
 */
interface ValidationError {
  message: string;
  type: 'warning' | 'error';
}

/**
 * Generate a contextual auto-query when the user submits data without typing a question.
 */
function generateAutoQuery(context: {
  hasFile: boolean;
  hasPage: boolean;
  hasPasted: boolean;
  selectedFile: File | null;
  capturedPageUrl: string | null;
}): string {
  const parts: string[] = [];

  if (context.hasFile && context.selectedFile) {
    const ext = context.selectedFile.name.split('.').pop()?.toLowerCase() || '';
    const typeHints: Record<string, string> = {
      log: 'Analyze these logs for errors, warnings, and anomalies.',
      json: 'Analyze this JSON data and identify any issues or notable patterns.',
      csv: 'Analyze this CSV data and summarize key findings.',
      txt: 'Analyze this text file and identify relevant information.',
      md: 'Review this document and extract key technical details.',
    };
    parts.push(typeHints[ext] || 'Analyze this file and identify relevant information.');
  }

  if (context.hasPasted) {
    parts.push('Analyze the pasted data for errors, patterns, and relevant details.');
  }

  if (context.hasPage && context.capturedPageUrl) {
    parts.push(`Analyze the captured page content from ${context.capturedPageUrl}.`);
  }

  if (parts.length === 1) return parts[0];
  return 'Analyze the attached data:\n' + parts.map((p, i) => `${i + 1}. ${p}`).join('\n');
}

export function UnifiedInputBar({
  disabled = false,
  loading = false,
  submitting = false,
  onQuerySubmit,
  onTurnSubmit,
  onPageInject,
  maxLength = INPUT_LIMITS.MAX_QUERY_LENGTH,
  placeholder = "Ask a question or paste data...",
}: UnifiedInputBarProps) {
  // Input state
  const [input, setInput] = useState("");
  const [inputMode, setInputMode] = useState<InputMode>('question');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [capturedPageUrl, setCapturedPageUrl] = useState<string | null>(null);
  const [capturedPageContent, setCapturedPageContent] = useState<string>("");
  const [stagedPastedContent, setStagedPastedContent] = useState<string>("");
  const [validationError, setValidationError] = useState<ValidationError | null>(null);
  const [isCapturingPage, setIsCapturingPage] = useState(false);
  const [isUploadingData, setIsUploadingData] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showPasteScratchpad, setShowPasteScratchpad] = useState(false);

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Smart input detection: count newlines to determine mode
  useEffect(() => {
    const lineCount = input.split('\n').length;
    const newMode: InputMode = lineCount >= INPUT_LIMITS.DATA_MODE_LINE_THRESHOLD ? 'data' : 'question';

    if (newMode !== inputMode) {
      setInputMode(newMode);
      log.debug('Mode switched', { newMode, lineCount });
    }
  }, [input, inputMode]);

  // Handle text input change
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;

    // Clear validation error when user starts typing
    if (validationError) {
      setValidationError(null);
    }

    // Warn if approaching limit (90% threshold)
    if (newValue.length > maxLength * 0.9 && newValue.length <= maxLength) {
      const sizeKB = (newValue.length / 1000).toFixed(1);
      const maxKB = (maxLength / 1000).toFixed(0);
      setValidationError({
        message: `Approaching limit: ${sizeKB}KB of ${maxKB}KB`,
        type: 'warning',
      });
    }

    setInput(newValue);
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter (without Shift): Submit in question mode
    if (e.key === 'Enter' && !e.shiftKey && inputMode === 'question') {
      e.preventDefault();
      handleSubmit();
    }

    // Shift+Enter: Always allow newline
    // (textarea default behavior)
  };

  // Clear all staged state after successful submission
  const clearAllStagedState = () => {
    setInput("");
    setSelectedFile(null);
    setCapturedPageUrl(null);
    setCapturedPageContent("");
    setStagedPastedContent("");
    setShowPasteScratchpad(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Unified submit handler
  const handleSubmit = async () => {
    const query = input.trim();
    const hasQuery = query.length > 0;
    const hasFile = selectedFile !== null;
    const hasPage = capturedPageUrl !== null && capturedPageContent.length > 0;
    const hasPasted = stagedPastedContent.length > 0;
    const hasAnyAttachment = hasFile || hasPage || hasPasted;

    // Nothing to submit
    if (!hasQuery && !hasAnyAttachment) return;
    if (disabled || loading || submitting || isUploadingData) return;

    // ROUTE 1: Query-only, question mode, no attachments → optimistic path
    if (hasQuery && !hasAnyAttachment && inputMode === 'question') {
      if (query.length > maxLength) {
        const sizeKB = (query.length / 1000).toFixed(1);
        const maxKB = (maxLength / 1000).toFixed(0);
        setValidationError({
          message: `Query too long (${sizeKB}KB). Maximum size is ${maxKB}KB.`,
          type: 'error',
        });
        return;
      }

      setValidationError(null);
      onQuerySubmit(query);
      setInput("");
      return;
    }

    // ROUTE 2: Has attachments OR data mode → unified turn submission
    setIsUploadingData(true);
    setValidationError(null);

    const payload: TurnPayload = {};

    // Data mode (long text in textarea): treat textarea content as pasted data
    if (inputMode === 'data' && hasQuery && !hasAnyAttachment) {
      payload.pastedContent = query;
      payload.query = generateAutoQuery({ hasFile: false, hasPage: false, hasPasted: true, selectedFile: null, capturedPageUrl: null });
    } else {
      // Normal: textarea text is the query
      if (hasQuery) {
        payload.query = query;
      } else {
        // No user query — auto-generate one
        payload.query = generateAutoQuery({ hasFile, hasPage, hasPasted, selectedFile, capturedPageUrl });
      }

      // Assemble pasted content (staged data + page content)
      if (hasPasted && hasPage) {
        const pageSection = `--- Page Content (${capturedPageUrl}) ---\n${capturedPageContent}`;
        payload.pastedContent = `${stagedPastedContent}\n\n${pageSection}`;
      } else if (hasPasted) {
        payload.pastedContent = stagedPastedContent;
      } else if (hasPage) {
        payload.pastedContent = `--- Page Content (${capturedPageUrl}) ---\n${capturedPageContent}`;
      }

      if (hasFile) {
        payload.files = [selectedFile!];
      }
    }

    try {
      const result = await onTurnSubmit(payload);
      if (result.success) {
        clearAllStagedState();
      } else {
        log.warn('Turn submission failed', { message: result.message });
      }
    } catch (error) {
      log.error('Unexpected error during turn submission', error);
    } finally {
      setIsUploadingData(false);
      // Always clear file/page state to prevent stuck UI
      setSelectedFile(null);
      setCapturedPageUrl(null);
      setCapturedPageContent("");
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Validate file before selection
  const validateFile = (file: File): ValidationError | null => {
    // Check file size
    if (file.size > INPUT_LIMITS.MAX_FILE_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      const maxSizeMB = (INPUT_LIMITS.MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
      return {
        message: `File too large (${sizeMB} MB). Maximum size is ${maxSizeMB} MB.`,
        type: 'error',
      };
    }

    // Check file extension
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!INPUT_LIMITS.ALLOWED_FILE_EXTENSIONS.includes(extension as any)) {
      return {
        message: `Invalid file type "${extension}". Allowed: ${INPUT_LIMITS.ALLOWED_FILE_EXTENSIONS.join(', ')}`,
        type: 'error',
      };
    }

    // Check MIME type if available
    if (file.type && !INPUT_LIMITS.ALLOWED_MIME_TYPES.includes(file.type as any)) {
      log.warn('File type not in allowed MIME types, but extension is valid', { fileType: file.type });
    }

    return null;
  };

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file
    const error = validateFile(file);
    if (error) {
      setValidationError(error);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = ''; // Reset input
      }
      return;
    }

    // File is valid
    setValidationError(null);
    setSelectedFile(file);
  };

  // Handle file upload button click
  const handleFileButtonClick = () => {
    fileInputRef.current?.click();
  };

  // Handle page injection button click
  const handlePageInjectClick = async () => {
    if (!onPageInject) return;

    setIsCapturingPage(true);
    setValidationError(null);

    try {
      const pageHtmlContent = await onPageInject();

      if (!pageHtmlContent || pageHtmlContent.trim().length === 0) {
        throw new Error('No page content captured');
      }

      setCapturedPageContent(pageHtmlContent);

      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab.url) {
        setCapturedPageUrl(tab.url);
        log.debug('Page captured', { url: tab.url, bytes: pageHtmlContent.length });
      } else {
        throw new Error('Could not retrieve current page URL');
      }
    } catch (error: any) {
      log.error('Page capture failed', error);
      setValidationError({
        message: error.message || 'Failed to capture page content',
        type: 'error',
      });
    } finally {
      setIsCapturingPage(false);
    }
  };

  // Remove handlers
  const handleRemoveFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemovePage = () => {
    setCapturedPageUrl(null);
    setCapturedPageContent("");
  };

  const handleRemovePastedContent = () => {
    setStagedPastedContent("");
  };

  // Drag & drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === dropZoneRef.current) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (isProcessing) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const file = files[0];
    const error = validateFile(file);
    if (error) {
      setValidationError(error);
      return;
    }

    setValidationError(null);
    setSelectedFile(file);
    log.debug('File dropped', { fileName: file.name });
  };

  // Calculate dynamic textarea rows
  const calculateRows = () => {
    const lineCount = input.split('\n').length;
    return Math.max(INPUT_LIMITS.TEXTAREA_MIN_ROWS, Math.min(INPUT_LIMITS.TEXTAREA_MAX_ROWS, lineCount));
  };

  // Derived state
  const hasAnyAttachment = selectedFile !== null || capturedPageUrl !== null || stagedPastedContent.length > 0;
  const isProcessing = disabled || loading || submitting || isCapturingPage || isUploadingData;
  const isInputDisabled = disabled || loading || submitting || isCapturingPage || isUploadingData;
  const canSubmit = (input.trim() || hasAnyAttachment) && !isProcessing;

  return (
    <div
      ref={dropZoneRef}
      className={`flex-shrink-0 bg-fm-surface border-t border-fm-border-subtle px-5 py-3 pb-4 relative transition-colors ${isDragging ? 'border-fm-accent border-2' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-fm-base/80 backdrop-blur-sm flex items-center justify-center z-50 rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-3 text-fm-accent">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <div className="text-center">
              <div className="text-sm font-semibold text-fm-text-primary">Drop file here</div>
              <div className="text-xs text-fm-text-tertiary">Supported: .txt, .log, .json, .csv, .md (max 10 MB)</div>
            </div>
          </div>
        </div>
      )}

      {/* Staging area — appears above input when items are staged */}
      {(hasAnyAttachment || validationError || (inputMode === 'data' && !selectedFile && !capturedPageUrl && !stagedPastedContent)) && (
        <div className="flex flex-col gap-1.5 mb-2.5">
          {/* Validation error */}
          {validationError && (
            <div
              className={`flex items-center justify-between gap-2 text-xs rounded-md px-2.5 py-1.5 ${validationError.type === 'error'
                ? 'text-fm-critical bg-fm-critical-bg border border-fm-critical-border'
                : 'text-fm-warning bg-fm-warning-bg border border-fm-warning-border'
                }`}
              role="alert"
              aria-live="polite"
            >
              <span>{validationError.message}</span>
              <button
                onClick={() => setValidationError(null)}
                className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
                title="Dismiss"
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          )}

          {/* Mode indicator */}
          {inputMode === 'data' && !selectedFile && !capturedPageUrl && !stagedPastedContent && !validationError && (
            <div
              className="flex items-center gap-2 text-xs text-fm-warning bg-fm-warning-bg border border-fm-warning-border rounded-md px-2.5 py-1.5"
              role="status"
            >
              <span>Large text detected — will be processed as data</span>
            </div>
          )}

          {/* Staged file */}
          {selectedFile && (
            <div className="flex items-center justify-between bg-fm-surface border border-dashed border-fm-border rounded-md px-3 py-2">
              <div className="flex items-center gap-2 text-xs min-w-0">
                <span>📄</span>
                <span className="font-semibold text-fm-text-primary font-mono truncate">{selectedFile.name}</span>
                <span className="text-fm-text-tertiary font-mono">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
              </div>
              <button onClick={handleRemoveFile} className="text-fm-text-tertiary hover:text-fm-text-primary text-xs ml-2" title="Remove file">✕</button>
            </div>
          )}

          {/* Staged pasted content */}
          {stagedPastedContent && !showPasteScratchpad && (
            <div className="bg-fm-surface border border-dashed border-fm-border rounded-md px-3 py-2">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11.5px] font-semibold text-fm-text-primary">📋 Pasted context</span>
                  <span className="text-[10px] text-fm-text-tertiary font-mono">
                    {stagedPastedContent.split('\n').length} lines · {(stagedPastedContent.length / 1024).toFixed(1)} KB
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setShowPasteScratchpad(true)} className="text-fm-text-tertiary hover:text-fm-text-primary text-[10px]" title="Edit">Edit</button>
                  <button onClick={handleRemovePastedContent} className="text-fm-text-tertiary hover:text-fm-text-primary text-xs" title="Remove">✕</button>
                </div>
              </div>
              <div className="bg-fm-bg rounded px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed overflow-hidden">
                {stagedPastedContent.split('\n').slice(0, 5).map((l, i) => (
                  <div key={i} className="flex gap-2 opacity-80">
                    <span className="text-fm-text-tertiary min-w-[16px] text-right select-none text-[10px]">{i + 1}</span>
                    <span className="text-fm-text-primary truncate">{l}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Staged captured page */}
          {capturedPageUrl && (
            <div className="flex items-center gap-2.5 px-3 py-2 bg-fm-surface border border-dashed border-fm-border rounded-md">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-fm-text-primary truncate">📸 Captured: {capturedPageUrl}</div>
                <div className="text-[10.5px] text-fm-text-tertiary">🔒 Secrets redacted · {(capturedPageContent.length / 1024).toFixed(0)} KB</div>
              </div>
              <button onClick={handleRemovePage} className="text-fm-text-tertiary hover:text-fm-text-primary text-xs flex-shrink-0" title="Remove">✕</button>
            </div>
          )}
        </div>
      )}

      {/* Paste Data Scratchpad */}
      {showPasteScratchpad && (
        <PasteDataScratchpad
          initialContent={stagedPastedContent}
          onStage={(content) => setStagedPastedContent(content)}
          onClear={() => setStagedPastedContent("")}
          onClose={() => setShowPasteScratchpad(false)}
        />
      )}

      {/* Input field row: [Page|Upload|Paste] [textarea] [Send] */}
      <div
        className={`flex items-end gap-1 bg-fm-surface-alt rounded-lg border px-1 py-1 transition-colors ${hasAnyAttachment ? 'border-fm-accent' : 'border-fm-border'
          }`}
      >
        {/* Left action buttons */}
        <div className="flex items-center gap-0.5 py-0.5 pl-0.5">
          {/* Analyze current page */}
          {isCapturingPage ? (
            <button
              type="button"
              onClick={() => setIsCapturingPage(false)}
              className="p-1.5 text-fm-accent rounded transition-colors"
              aria-label="Cancel page capture"
              title="Cancel capture"
            >
              <div className="w-4 h-4 border-2 border-fm-border border-t-fm-accent rounded-full animate-spin" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePageInjectClick}
              disabled={isProcessing || !onPageInject}
              className={`p-1.5 rounded transition-colors disabled:opacity-50 ${capturedPageUrl
                ? 'text-fm-accent bg-fm-accent-soft'
                : 'text-fm-text-tertiary hover:text-fm-text-primary'
                }`}
              aria-label="Analyze current page"
              title="Analyze current page"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
          )}

          {/* File upload */}
          <button
            type="button"
            onClick={handleFileButtonClick}
            disabled={isProcessing}
            className={`p-1.5 rounded transition-colors disabled:opacity-50 ${selectedFile
              ? 'text-fm-success bg-fm-success-bg'
              : 'text-fm-text-tertiary hover:text-fm-text-primary'
              }`}
            aria-label="Upload file"
            title="Upload file"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          {/* Paste data toggle */}
          <button
            type="button"
            onClick={() => setShowPasteScratchpad(!showPasteScratchpad)}
            disabled={isProcessing}
            className={`p-1.5 rounded transition-colors disabled:opacity-50 ${showPasteScratchpad || stagedPastedContent
              ? 'text-fm-accent bg-fm-accent-soft'
              : 'text-fm-text-tertiary hover:text-fm-text-primary'
              }`}
            aria-label="Paste data"
            title="Paste data"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
            </svg>
          </button>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            submitting || isUploadingData
              ? 'Processing...'
              : hasAnyAttachment
                ? 'Ask about the context...'
                : placeholder || 'Ask FaultMaven...'
          }
          rows={calculateRows()}
          maxLength={maxLength}
          disabled={isInputDisabled}
          className="flex-1 bg-transparent border-none text-fm-text-primary text-[13px] leading-relaxed resize-none outline-none px-1.5 py-1 font-sans disabled:opacity-50"
          style={{ minHeight: 22, maxHeight: 180 }}
          aria-label="Type your message"
        />

        {/* Send button — right side */}
        <div className="flex items-center py-0.5 pr-0.5">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`p-1.5 rounded-md transition-colors ${canSubmit
              ? 'text-white bg-fm-accent-gradient shadow-fm-glow hover:opacity-90'
              : 'text-fm-text-tertiary bg-white/5'
              }`}
            aria-label="Send message"
            title="Send"
          >
            {submitting || isUploadingData ? (
              <div className="w-4 h-4 border-2 border-fm-bg/30 border-t-fm-bg rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileSelect}
        accept=".txt,.log,.json,.csv,.md"
        className="hidden"
        aria-label="File input"
      />

      {/* Character count */}
      {input.length > maxLength * 0.8 && !submitting && !isCapturingPage && (
        <div className="text-[10px] text-fm-text-tertiary text-right mt-1" aria-live="polite">
          {input.length}/{maxLength}
        </div>
      )}
    </div>
  );
}
