/**
 * Unified Input Bar Component
 *
 * Smart input component with a single Send button for all turn content:
 * - Query text (typed in textarea)
 * - Pasted data (staged via scratchpad)
 * - File uploads
 * - Captured page content
 *
 * A turn carries at most one file, plus either pasted data or a captured page.
 * A file and a paste go together (core keeps `files` and `pasted_content` as
 * separate attachments and reads `input_type` only for the paste). A page and a
 * paste cannot: both travel in `pasted_content`, so one replaces the other. A
 * file and a page still replace each other, as before.
 * Query-only submissions use the optimistic UI path (onQuerySubmit).
 * Submissions with attachments use the unified turn path (onTurnSubmit).
 *
 * What the user types is a message, never data (#327): only the textpad, a file
 * or a captured page is. A multi-line paste EVENT into the box goes to the
 * textpad and leaves the typed words in place; one action puts it back.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useHost } from '../../host';
import { createLogger } from '../../../lib/utils/logger';
import {
  appendBlock,
  countLines,
  normalizeLineBreaks,
  stripBlankEdgeLines,
} from '../../../lib/utils/pasted-data';
import { PasteDataScratchpad } from './PasteDataScratchpad';

const log = createLogger('UnifiedInputBar');
import { INPUT_LIMITS } from '../layouts/constants';

/**
 * What a turn submission reports to the composer. `sent: false` means the turn
 * never reached the server (no session, case creation failed): the composer
 * keeps the staged input so sending again needs no re-pick. A turn that WAS sent
 * and failed keeps its own Retry through the pending operation, so it reports
 * `sent: true`, and the composer clears everything. The exception is a turn the
 * server refused outright (`refused`, a 409 `CASE_TERMINAL`): nothing was stored
 * and there is no Retry, so the composer keeps what was staged.
 */
export type QuerySubmitResult = { sent: boolean };

export type TurnSubmitResult = {
  success: boolean;
  message: string;
  sent: boolean;
  /**
   * The server received the turn and refused it before storing anything (a
   * terminal case takes no data). Distinct from `sent: false`, which means the
   * turn never reached the server: here the request WAS delivered, but the
   * composer must keep what the user staged, since nothing was added.
   */
  refused?: boolean;
};

/**
 * Payload for submissions with attachments (files, pasted data, page content).
 * Sent via the unified /turns endpoint.
 */
export interface TurnPayload {
  query?: string;
  pastedContent?: string;
  files?: File[];
  /** Explicit input origin so the backend can set correct source_metadata */
  inputType?: 'file' | 'page_capture' | 'paste';
  /** `query` was generated for a turn the user typed no text for. */
  queryIsGenerated?: boolean;
  /** Source URL for page_capture inputs */
  sourceUrl?: string;
}

export interface UnifiedInputBarProps {
  // State
  disabled?: boolean;
  disableAttachments?: boolean;
  loading?: boolean;
  submitting?: boolean;

  // Callbacks
  /**
   * A query-only submission. When it resolves `{ sent: false }` (no case could
   * be created, no session) the typed text is put back in the box.
   */
  onQuerySubmit: (query: string) => void | Promise<QuerySubmitResult | void>;
  onTurnSubmit: (payload: TurnPayload) => Promise<TurnSubmitResult>;

  // Configuration
  maxLength?: number;
  placeholder?: string;
}

/**
 * Validation error state
 */
interface ValidationError {
  message: string;
  /**
   * `info` is not a lesser error. It is the level for something the user asked
   * for that this host cannot do — an explanation, not a failure — so it must
   * not be dressed in the red or amber of something that went wrong.
   */
  type: 'info' | 'warning' | 'error';
  /** An outbound link rendered beside the message, e.g. the store listing. */
  action?: { label: string; href: string };
}

/**
 * What one multi-line paste did, so one action can reverse it: the user may
 * have pasted their own words.
 */
interface PasteUndo {
  /** The pasted text as the box would have received it. */
  text: string;
  lines: number;
  /** The box and its selection when the paste arrived. */
  box: string;
  selectionStart: number;
  selectionEnd: number;
  /** The textpad before and after the paste. */
  textpadBefore: string;
  textpadAfter: string;
  /** The staged file and page right after the paste. */
  fileAfter: File | null;
  pageUrlAfter: string | null;
  /** A captured page the paste replaced (page and paste share `pasted_content`). */
  replaced: { pageUrl: string | null; pageContent: string } | null;
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
  disableAttachments = false,
  loading = false,
  submitting = false,
  onQuerySubmit,
  onTurnSubmit,
  maxLength = INPUT_LIMITS.MAX_QUERY_LENGTH,
  placeholder = "Ask a question or paste data...",
}: UnifiedInputBarProps) {
  // Input state
  const [input, setInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [capturedPageUrl, setCapturedPageUrl] = useState<string | null>(null);
  const [capturedPageContent, setCapturedPageContent] = useState<string>("");
  const [stagedPastedContent, setStagedPastedContentRaw] = useState<string>("");
  /**
   * Staged pasted data is always held normalised (blank edge lines stripped,
   * nothing else), so every emptiness test is on exactly what would be sent.
   */
  const setStagedPastedContent = (value: string) => setStagedPastedContentRaw(stripBlankEdgeLines(value));
  const { pageCapture } = useHost();
  const [validationError, setValidationError] = useState<ValidationError | null>(null);
  const [isCapturingPage, setIsCapturingPage] = useState(false);
  const [isUploadingData, setIsUploadingData] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showPasteScratchpad, setShowPasteScratchpad] = useState(false);
  // The open textpad's text. It is staged on Done, and Send carries it too.
  const [pasteDraft, setPasteDraft] = useState("");
  const [pasteUndo, setPasteUndo] = useState<PasteUndo | null>(null);

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  /** Where the caret goes once the box shows text put back by the undo. */
  const pendingCaretRef = useRef<number | null>(null);

  useEffect(() => {
    const caret = pendingCaretRef.current;
    const el = textareaRef.current;
    if (caret === null || !el) return;
    pendingCaretRef.current = null;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [input]);

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
    // Enter (without Shift): Submit
    if (e.key === 'Enter' && !e.shiftKey) {
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
    setPasteDraft("");
    setPasteUndo(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Unified submit handler
  const handleSubmit = async () => {
    const query = input.trim();
    const hasQuery = query.length > 0;
    // While the textpad is open, what it shows IS the paste: Send carries it as
    // Done would, and an emptied textpad means no pasted data.
    const pastedData = showPasteScratchpad ? stripBlankEdgeLines(pasteDraft) : stagedPastedContent;
    const hasFile = selectedFile !== null;
    const hasPage = capturedPageUrl !== null && capturedPageContent.length > 0;
    const hasPasted = pastedData.length > 0;
    const hasAnyAttachment = hasFile || hasPage || hasPasted;

    // Nothing to submit
    if (!hasQuery && !hasAnyAttachment) return;
    if (disabled || loading || submitting || isUploadingData) return;

    // One limit for the message on every route. The box's own maxLength only
    // stops typing; text set by the component is checked here.
    if (query.length > maxLength) {
      const sizeKB = (query.length / 1000).toFixed(1);
      const maxKB = (maxLength / 1000).toFixed(0);
      setValidationError({
        message: `Query too long (${sizeKB}KB). Maximum size is ${maxKB}KB.`,
        type: 'error',
      });
      return;
    }

    // An attachment staged before the case turned terminal: the server would
    // refuse it, so send nothing and leave the staged content in place.
    if (disableAttachments && hasAnyAttachment) {
      setValidationError({
        message: 'Attachments can’t be added to a closed case. Remove them to send your message.',
        type: 'error',
      });
      return;
    }

    // A captured page and pasted data share `pasted_content`, so a turn holds
    // one or the other. Done in the open textpad would replace the page; Send
    // does not choose for the user. (A staged file goes with the paste.)
    if (showPasteScratchpad && hasPasted && capturedPageUrl !== null) {
      setValidationError({
        message: 'A captured page and pasted data can’t go in one message. Press Done to send the pasted data instead of the page, or clear it.',
        type: 'error',
      });
      return;
    }
    if (showPasteScratchpad) {
      setStagedPastedContent(pastedData);
      setShowPasteScratchpad(false);
    }

    // ROUTE 1: Query-only, no attachments → optimistic path
    if (hasQuery && !hasAnyAttachment) {
      setValidationError(null);
      const pending = onQuerySubmit(query);
      setInput("");
      // Restore the text if the submission never reached the server, unless the
      // user has already started typing something else.
      Promise.resolve(pending)
        .then((outcome) => {
          if (outcome && outcome.sent === false) {
            setInput((current) => (current === '' ? query : current));
          }
        })
        .catch((error) => log.error('Query submission rejected', error));
      return;
    }

    // ROUTE 2: Has attachments → unified turn submission
    setIsUploadingData(true);
    setValidationError(null);

    const payload: TurnPayload = {};

    // The box is always the user's message, never data.
    if (hasQuery) {
      payload.query = query;
    } else {
      // No user query — auto-generate one
      payload.query = generateAutoQuery({ hasFile, hasPage, hasPasted, selectedFile, capturedPageUrl });
      payload.queryIsGenerated = true;
    }

    // `pasted_content` carries the paste or the page, never both. The paste is
    // sent as staged: verbatim, with only blank edge lines removed.
    if (hasPasted) {
      payload.pastedContent = pastedData;
      payload.inputType = 'paste';
    } else if (hasPage) {
      payload.pastedContent = `--- Page Content (${capturedPageUrl}) ---\n${capturedPageContent}`;
      payload.inputType = 'page_capture';
      payload.sourceUrl = capturedPageUrl ?? undefined;
    }

    if (hasFile) {
      payload.files = [selectedFile!];
      // `input_type` describes `pasted_content` (core ignores it for files), so
      // a file says 'file' only when no paste goes with it.
      if (!hasPasted) payload.inputType = 'file';
    }

    // A submission that never reached the server (`sent === false`) keeps the
    // staged input: the user was told what was not sent and sends it again
    // without re-picking.
    let keepStaged = false;
    try {
      const result = await onTurnSubmit(payload);
      if (result.success) {
        clearAllStagedState();
      } else {
        keepStaged = !result.sent || result.refused === true;
        // A turn that WAS sent and failed has its own Retry in the banner; a
        // composer still holding its text would invite a second, text-only send.
        // A refused one stored nothing and has no Retry: the staged input is
        // the only copy the user has.
        if (result.sent && !result.refused) clearAllStagedState();
        log.warn('Turn submission failed', { message: result.message });
      }
    } catch (error) {
      log.error('Unexpected error during turn submission', error);
      // Unknown whether it was sent: never discard the user's input.
      keepStaged = true;
    } finally {
      setIsUploadingData(false);
      if (!keepStaged) {
        // Clear file/page state to prevent stuck UI
        setSelectedFile(null);
        setCapturedPageUrl(null);
        setCapturedPageContent("");
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
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

    // File is valid. It replaces a captured page; staged pasted data goes with it.
    setValidationError(null);
    setSelectedFile(file);
    setCapturedPageUrl(null);
    setCapturedPageContent("");
  };

  // Handle file upload button click
  const handleFileButtonClick = () => {
    fileInputRef.current?.click();
  };

  // Handle page injection button click
  const handlePageInjectClick = async () => {
    // The one capability a web page cannot have: it cannot read another tab.
    // The button is still drawn and still enabled — hiding or disabling it
    // would leave the user to guess why the feature they were told about is
    // missing — so pressing it explains, and offers the way to get it.
    if (!pageCapture.supported) {
      setValidationError({
        type: 'info',
        message: pageCapture.reason,
        action: { label: 'Install the Copilot extension', href: pageCapture.installUrl },
      });
      return;
    }

    setIsCapturingPage(true);
    setValidationError(null);

    try {
      // The hook returns the URL of the tab it actually injected into —
      // already allowlist-vetted and fragment-stripped. Do NOT re-query the
      // active tab here: the user can switch tabs while the capture's
      // permission prompt is open, and a second query would attribute the
      // captured content to the wrong page.
      const { content: pageHtmlContent, url: pageUrl } = await pageCapture.capture();

      if (!pageHtmlContent || pageHtmlContent.trim().length === 0) {
        throw new Error('No page content captured');
      }

      // A page replaces pasted data (both travel in `pasted_content`) and,
      // as before, a staged file.
      setSelectedFile(null);
      setStagedPastedContent("");
      setShowPasteScratchpad(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      setCapturedPageContent(pageHtmlContent);
      setCapturedPageUrl(pageUrl);
      log.debug('Page captured', { url: pageUrl, bytes: pageHtmlContent.length });
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

  // Stage the textpad's text (its Done). Empty means no pasted data. A staged
  // file stays and goes with it; a captured page is replaced by real data,
  // because both would travel in `pasted_content`.
  const stagePastedData = (content: string) => {
    const data = stripBlankEdgeLines(content);
    if (data) {
      setCapturedPageUrl(null);
      setCapturedPageContent("");
    }
    setStagedPastedContent(data);
  };

  const openTextpad = () => {
    setPasteDraft(stagedPastedContent);
    setShowPasteScratchpad(true);
  };

  // Closing from the Paste button stages what the textpad holds, like its own
  // close button and Escape, so a paste that landed there is not dropped.
  const closeTextpad = () => {
    stagePastedData(pasteDraft);
    setShowPasteScratchpad(false);
  };

  // A multi-line paste is data unless the user says otherwise (#327). It goes
  // to the textpad, the words already in the box stay there, and one action
  // puts it back. Only the paste EVENT counts: typing never moves anything.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // A closed case takes no data: the paste goes in the box, as text.
    if (disableAttachments) return;
    const raw = e.clipboardData?.getData('text/plain') ?? '';
    const data = stripBlankEdgeLines(raw);
    const lines = countLines(data);
    if (lines < INPUT_LIMITS.PASTE_TO_TEXTPAD_LINE_THRESHOLD) return;
    e.preventDefault();

    const { selectionStart, selectionEnd } = e.currentTarget;
    const moved = { text: normalizeLineBreaks(raw), lines, box: input, selectionStart, selectionEnd };
    const hadPage = capturedPageUrl !== null;

    if (showPasteScratchpad) {
      // The open textpad takes it after what it holds; Done or Send stages it.
      const after = appendBlock(pasteDraft, data);
      setPasteDraft(after);
      setPasteUndo({
        ...moved,
        textpadBefore: pasteDraft,
        textpadAfter: after,
        fileAfter: selectedFile,
        pageUrlAfter: capturedPageUrl,
        replaced: null,
      });
    } else {
      // Added after what the textpad already holds, never in place of it. A
      // staged file stays and goes in the same turn. A captured page is
      // replaced (page and paste both travel in `pasted_content`); the notice
      // says so and the undo restores it.
      const replaced = hadPage
        ? { pageUrl: capturedPageUrl, pageContent: capturedPageContent }
        : null;
      const after = stripBlankEdgeLines(appendBlock(stagedPastedContent, data));
      stagePastedData(after);
      setPasteUndo({
        ...moved,
        textpadBefore: stagedPastedContent,
        textpadAfter: after,
        fileAfter: selectedFile,
        pageUrlAfter: null,
        replaced,
      });
    }
    log.debug('Multi-line paste moved to the textpad', {
      lines,
      intoOpenTextpad: showPasteScratchpad,
      replacedPage: !showPasteScratchpad && hadPage,
    });
  };

  // The undo reverses one paste against the staged set it left behind. Any
  // other change to that set (a file picked, dropped or removed, a page
  // captured or removed, the textpad edited, staged or cleared) withdraws it
  // for good, so it can never restore an attachment the current set excludes.
  const pasteUndoAvailable =
    pasteUndo !== null &&
    (showPasteScratchpad ? pasteDraft : stagedPastedContent) === pasteUndo.textpadAfter &&
    selectedFile === pasteUndo.fileAfter &&
    capturedPageUrl === pasteUndo.pageUrlAfter;

  useEffect(() => {
    if (pasteUndo !== null && !pasteUndoAvailable) setPasteUndo(null);
  }, [pasteUndo, pasteUndoAvailable]);

  // Put the paste back in the box: at the caret it was pasted at when the box
  // is as it was then, otherwise after what the box now holds.
  const handleUndoPaste = () => {
    const undo = pasteUndo;
    if (!undo || !pasteUndoAvailable) return;
    const unchanged = input === undo.box;
    const next = unchanged
      ? input.slice(0, undo.selectionStart) + undo.text + input.slice(undo.selectionEnd)
      : input + (input === '' || input.endsWith('\n') ? '' : '\n') + undo.text;
    // Never truncate the user's text to fit: refuse, and leave both where they are.
    if (next.length > maxLength) {
      setValidationError({
        message: `Putting the paste back would take the message past the ${maxLength.toLocaleString()}-character limit, so it stays in Paste data.`,
        type: 'error',
      });
      return;
    }
    if (showPasteScratchpad) setPasteDraft(undo.textpadBefore);
    // Normalised by the setter: a whitespace-only textpad stages nothing.
    if (stagedPastedContent === undo.textpadAfter) setStagedPastedContent(undo.textpadBefore);
    if (undo.replaced) {
      setCapturedPageUrl(undo.replaced.pageUrl);
      setCapturedPageContent(undo.replaced.pageContent);
    }
    pendingCaretRef.current = unchanged ? undo.selectionStart + undo.text.length : next.length;
    setInput(next);
    setPasteUndo(null);
  };

  // Drag & drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disableAttachments) return;
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
    e.dataTransfer.dropEffect = disableAttachments ? 'none' : 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disableAttachments || isProcessing) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const file = files[0];
    const error = validateFile(file);
    if (error) {
      setValidationError(error);
      return;
    }

    // As a picked file: it replaces a captured page; staged pasted data goes with it.
    setValidationError(null);
    setSelectedFile(file);
    setCapturedPageUrl(null);
    setCapturedPageContent("");
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
  const hasOpenDraft = showPasteScratchpad && pasteDraft.trim().length > 0;
  const canSubmit = (input.trim() || hasAnyAttachment || hasOpenDraft) && !isProcessing;

  return (
    <div
      ref={dropZoneRef}
      className={`flex-shrink-0 bg-fm-surface border-t border-fm-border-subtle px-5 py-3 pb-4 relative transition-colors ${isDragging ? 'border-fm-accent border-2' : ''}`}
      role="form"
      aria-label="Message Input"
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
      {(hasAnyAttachment || validationError || pasteUndoAvailable) && (
        <div className="flex flex-col gap-1.5 mb-2.5">
          {/* Validation error */}
          {validationError && (
            <div
              className={`flex items-center justify-between gap-2 text-xs rounded-md px-2.5 py-1.5 ${validationError.type === 'error'
                ? 'text-fm-critical bg-fm-critical-bg border border-fm-critical-border'
                : validationError.type === 'info'
                  ? 'text-fm-info bg-fm-info-bg border border-fm-info-border'
                  : 'text-fm-warning bg-fm-warning-bg border border-fm-warning-border'
                }`}
              /* `alert` interrupts a screen reader; an explanation of a missing
                 capability is a status, not an emergency. */
              role={validationError.type === 'info' ? 'status' : 'alert'}
              aria-live="polite"
            >
              <span>
                {validationError.message}
                {validationError.action && (
                  <>
                    {' '}
                    <a
                      href={validationError.action.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-medium whitespace-nowrap"
                    >
                      {validationError.action.label}
                    </a>
                  </>
                )}
              </span>
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

          {/* A multi-line paste went to the textpad: say so, and offer it back */}
          {pasteUndoAvailable && pasteUndo && (
            <div
              className="flex items-center justify-between gap-2 text-xs text-fm-info bg-fm-info-bg border border-fm-info-border rounded-md px-2.5 py-1.5"
              role="status"
            >
              <span>
                Moved {pasteUndo.lines} pasted lines to Paste data
                {pasteUndo.replaced ? ', replacing the captured page' : ''}.
              </span>
              <button
                type="button"
                onClick={handleUndoPaste}
                className="flex-shrink-0 underline font-medium whitespace-nowrap"
              >
                Put back in message
              </button>
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
              <button onClick={handleRemoveFile} className="text-fm-text-tertiary hover:text-fm-text-primary text-xs ml-2" title="Remove file" aria-label="Remove file">✕</button>
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
                  <button onClick={openTextpad} className="text-fm-text-tertiary hover:text-fm-text-primary text-[10px]" title="Edit">Edit</button>
                  <button onClick={handleRemovePastedContent} className="text-fm-text-tertiary hover:text-fm-text-primary text-xs" title="Remove" aria-label="Remove pasted data">✕</button>
                </div>
              </div>
              <div className="bg-fm-bg rounded px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed overflow-hidden">
                {stagedPastedContent.split('\n').slice(0, 5).map((l, i) => (
                  <div key={i} className="flex gap-2 opacity-80">
                    <span className="text-fm-text-tertiary min-w-[16px] text-right select-none text-[10px]">{i + 1}</span>
                    <span className="text-fm-text-primary truncate whitespace-pre">{l}</span>
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
                <div className="text-[10.5px] text-fm-text-tertiary">{(capturedPageContent.length / 1024).toFixed(0)} KB</div>
              </div>
              <button onClick={handleRemovePage} className="text-fm-text-tertiary hover:text-fm-text-primary text-xs flex-shrink-0" title="Remove">✕</button>
            </div>
          )}
        </div>
      )}

      {/* Paste Data Scratchpad */}
      {showPasteScratchpad && (
        <PasteDataScratchpad
          value={pasteDraft}
          onChange={setPasteDraft}
          onStage={stagePastedData}
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
              // Deliberately NOT gated on whether capture is supported: a
              // disabled button explains nothing. See handlePageInjectClick.
              disabled={isProcessing || disableAttachments}
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
            disabled={isProcessing || disableAttachments}
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
            onClick={showPasteScratchpad ? closeTextpad : openTextpad}
            disabled={isProcessing || disableAttachments}
            className={`p-1.5 rounded transition-colors disabled:opacity-50 ${showPasteScratchpad || stagedPastedContent
              ? 'text-fm-accent bg-fm-accent-soft'
              : 'text-fm-text-tertiary hover:text-fm-text-primary'
              }`}
            aria-label="Paste data"
            title="Paste data: logs, command output, config"
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
          onPaste={handlePaste}
          placeholder={
            submitting || isUploadingData
              ? 'Processing...'
              : hasAnyAttachment
                ? 'Ask about the data...'
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
