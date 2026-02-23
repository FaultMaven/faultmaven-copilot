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
      console.warn(`[UnifiedInputBar] File type "${file.type}" not in allowed MIME types, but extension is valid`);
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
      console.error('[UnifiedInputBar] Page capture failed:', error);
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
      className={`flex-shrink-0 bg-white border-t p-3 space-y-2 relative transition-colors ${
        isDragging
          ? 'border-blue-500 border-4 bg-blue-50'
          : 'border-gray-200'
      }`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-blue-100/80 backdrop-blur-sm flex items-center justify-center z-50 rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-3 text-blue-700">
            <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <div className="text-center">
              <div className="text-lg font-semibold">Drop file here</div>
              <div className="text-sm">Supported: .txt, .log, .json, .csv, .md (max 10 MB)</div>
            </div>
          </div>
        </div>
      )}
      {/* Validation error display */}
      {validationError && (
        <div
          className={`flex items-center gap-2 text-xs rounded px-2 py-1 ${
            validationError.type === 'error'
              ? 'text-red-600 bg-red-50 border border-red-200'
              : 'text-yellow-600 bg-yellow-50 border border-yellow-200'
          }`}
          role="alert"
          aria-live="polite"
        >
          <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{validationError.message}</span>
        </div>
      )}

      {/* Mode indicator (only show in data mode when textarea has long text, no other attachments) */}
      {inputMode === 'data' && !selectedFile && !capturedPageUrl && !stagedPastedContent && !validationError && (
        <div
          className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded px-2 py-1"
          role="status"
          aria-label="Input mode: Data upload"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>Large text detected - will be processed as data</span>
        </div>
      )}

      {/* File indicator */}
      {selectedFile && (
        <div
          className="flex items-center justify-between gap-2 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-1"
          role="status"
          aria-label={`Selected file: ${selectedFile.name}`}
        >
          <div className="flex items-center gap-2">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>{selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)</span>
          </div>
          <button
            onClick={handleRemoveFile}
            className="text-blue-600 hover:text-blue-800"
            title="Remove file"
            aria-label={`Remove file ${selectedFile.name}`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Pasted data indicator */}
      {stagedPastedContent && !showPasteScratchpad && (
        <div
          className="flex items-center justify-between gap-2 text-xs text-purple-600 bg-purple-50 border border-purple-200 rounded px-2 py-1"
          role="status"
          aria-label={`Pasted data: ${stagedPastedContent.split('\n').length} lines`}
        >
          <div className="flex items-center gap-2">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
            </svg>
            <span>
              Pasted data ({stagedPastedContent.split('\n').length} lines, {stagedPastedContent.length.toLocaleString()} chars)
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowPasteScratchpad(true)}
              className="text-purple-600 hover:text-purple-800"
              title="Edit pasted data"
              aria-label="Edit pasted data"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={handleRemovePastedContent}
              className="text-purple-600 hover:text-purple-800"
              title="Remove pasted data"
              aria-label="Remove pasted data"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Captured Page indicator */}
      {capturedPageUrl && (
        <div
          className="flex items-center justify-between gap-2 text-xs text-green-600 bg-green-50 border border-green-200 rounded px-2 py-1"
          role="status"
          aria-label={`Captured page: ${capturedPageUrl}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            <span className="truncate" title={capturedPageUrl}>{capturedPageUrl}</span>
          </div>
          <button
            onClick={handleRemovePage}
            className="text-green-600 hover:text-green-800 flex-shrink-0"
            title="Remove captured page"
            aria-label={`Remove captured page ${capturedPageUrl}`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Paste Data Scratchpad (staging area) */}
      {showPasteScratchpad && (
        <PasteDataScratchpad
          initialContent={stagedPastedContent}
          onStage={(content) => setStagedPastedContent(content)}
          onClear={() => setStagedPastedContent("")}
          onClose={() => setShowPasteScratchpad(false)}
        />
      )}

      {/* Input area */}
      <div className="flex items-end gap-2 relative">
        {/* Textarea */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              submitting || isCapturingPage || isUploadingData
                ? (isCapturingPage ? "Capturing page..." : isUploadingData ? "Sending..." : "Processing...")
                : hasAnyAttachment
                  ? "Type a question about the attached data, or just hit Send..."
                  : placeholder
            }
            rows={calculateRows()}
            maxLength={maxLength}
            disabled={isInputDisabled}
            className="block w-full p-2 text-sm border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
            aria-label="Type your message"
            aria-describedby="input-help-text"
          />

          {/* Loading overlay with compact spinner */}
          {(submitting || isCapturingPage || isUploadingData) && (
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50/95 to-white/95 backdrop-blur-sm flex items-center justify-center rounded border-2 border-blue-200" aria-live="polite" role="status">
              <div className="flex items-center gap-2 px-3 py-1.5">
                <div className="relative">
                  <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle>
                    <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <div className="absolute inset-0 animate-ping opacity-75">
                    <svg className="h-4 w-4 text-blue-400 opacity-20" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"></circle>
                    </svg>
                  </div>
                </div>
                <span className="text-xs font-medium text-blue-700">
                  {isCapturingPage ? 'Capturing page...' : isUploadingData ? 'Sending...' : 'Processing...'}
                </span>
              </div>
            </div>
          )}

          {/* Character count (show when approaching limit) */}
          {input.length > maxLength * 0.8 && !submitting && !isCapturingPage && (
            <div className="absolute bottom-1 right-1 text-xs text-gray-400" aria-live="polite">
              {input.length}/{maxLength}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {/* File upload button */}
          <button
            type="button"
            onClick={handleFileButtonClick}
            disabled={isProcessing}
            className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Upload file"
            title="Upload file (.txt, .log, .json, .csv, .md up to 10 MB)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>

          {/* Paste data button — always visible */}
          <button
            type="button"
            onClick={() => setShowPasteScratchpad(!showPasteScratchpad)}
            disabled={isProcessing}
            className={`p-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              showPasteScratchpad || stagedPastedContent
                ? 'text-purple-600 bg-purple-100 hover:bg-purple-200'
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
            }`}
            aria-label="Toggle paste data scratchpad"
            title="Paste data (logs, configs, error traces)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
            </svg>
          </button>

          {/* Page injection button */}
          {onPageInject && (
            <button
              type="button"
              onClick={handlePageInjectClick}
              disabled={isProcessing}
              className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Inject current page content"
              title="Capture and analyze current page"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
          )}

          {/* Submit button — single Send for all content */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
            aria-label="Send message"
          >
            {submitting || isUploadingData ? 'Sending...' : 'Send'}
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

      {/* Help text */}
      <div id="input-help-text" className="text-xs text-gray-500">
        {hasAnyAttachment ? (
          <span>Data attached - type a question or hit Send to analyze</span>
        ) : inputMode === 'question' ? (
          <span>Press Enter to send &middot; Shift+Enter for new line</span>
        ) : (
          <span>Large text will be processed as data for analysis</span>
        )}
      </div>
    </div>
  );
}
