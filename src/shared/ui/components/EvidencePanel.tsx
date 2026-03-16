import React, { useState, memo } from 'react';
import { UploadedData, formatFileSize, formatDataType } from '../../../lib/api';

interface EvidencePanelProps {
  evidence: UploadedData[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onViewAnalysis: (item: UploadedData) => void;
}

/**
 * Evidence Panel Component
 *
 * Displays uploaded/pasted/injected evidence for a case with:
 * - Collapsible list view
 * - Evidence metadata (source, timestamp, size)
 * - Action: View Analysis
 *
 * Phase 3 Week 7: Evidence Management
 */
export const EvidencePanel: React.FC<EvidencePanelProps> = memo(({
  evidence,
  isExpanded,
  onToggleExpand,
  onViewAnalysis
}) => {
  if (evidence.length === 0) {
    return null;
  }

  return (
    <div className="evidence-panel border-b border-fm-border bg-fm-bg">
      {/* Collapsible header */}
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center justify-between px-4 py-2 text-xs font-medium text-fm-text-secondary hover:bg-fm-surface transition-colors"
        aria-expanded={isExpanded}
      >
        <span className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
          </svg>
          Evidence ({evidence.length})
        </span>
        <svg
          className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <div id="evidence-list" className="px-4 pb-4 pt-1 space-y-3">
          {evidence.map((item) => (
            <EvidenceItem
              key={(item as any).evidence_id ?? item.data_id}
              item={item}
              onViewAnalysis={() => onViewAnalysis(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
});

EvidencePanel.displayName = 'EvidencePanel';

/**
 * Individual Evidence Item
 */
interface EvidenceItemProps {
  item: UploadedData;
  onViewAnalysis: () => void;
}

const EvidenceItem: React.FC<EvidenceItemProps> = memo(({
  item,
  onViewAnalysis
}) => {
  const [isHovered, setIsHovered] = useState(false);

  // Determine source icon and label
  const sourceInfo = getSourceInfo(item);

  // Format timestamp — guard against missing or invalid dates
  const rawDate = (item as any).uploaded_at ?? item.uploaded_at;
  const uploadedDate = rawDate ? new Date(rawDate) : null;
  const isValidDate = uploadedDate !== null && !isNaN(uploadedDate.getTime());
  const formattedDate = isValidDate
    ? uploadedDate!.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const formattedTime = isValidDate
    ? uploadedDate!.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : null;

  return (
    <div
      className="evidence-item bg-fm-surface border border-fm-border rounded-lg p-3 hover:shadow-md transition-shadow"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="article"
      aria-label={`Evidence: ${item.filename || 'content'}`}
    >
      {/* Header Row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-base flex-shrink-0" aria-hidden="true">{sourceInfo.icon}</span>
          <h3 className="text-sm font-semibold text-white truncate">
            {item.filename || `Content (${((item as any).evidence_id ?? item.data_id ?? '').substring(0, 7)})`}
          </h3>
          {item.file_size && (
            <span className="text-xs text-fm-text-tertiary flex-shrink-0">
              ({formatFileSize(item.file_size)})
            </span>
          )}
        </div>
      </div>

      {/* Metadata Row */}
      <div className="text-xs text-fm-text-tertiary mb-2 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{sourceInfo.label}:</span>
          <span>{formattedDate ? `${formattedDate}, ${formattedTime}` : 'Just now'}</span>
        </div>

        {sourceInfo.url && (
          <div className="flex items-center gap-2 truncate">
            <span className="font-medium">From:</span>
            <a
              href={sourceInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fm-accent hover:underline truncate"
            >
              {sourceInfo.url}
            </a>
          </div>
        )}

        {/* Data Type Classification */}
        {item.classification && (
          <div className="flex items-center gap-2">
            <span className="font-medium">Type:</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-fm-accent-soft text-fm-accent">
              {formatDataType(item.classification.data_type)}
            </span>
          </div>
        )}

        {/* Status */}
        <div className="flex items-center gap-2">
          <span className="font-medium">Status:</span>
          {(item as any).processing_status === 'failed' ? (
            <span className="inline-flex items-center gap-1 text-fm-error">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              Failed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-fm-success">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              Analyzed
            </span>
          )}
        </div>
      </div>

      {/* Action Button */}
      <div className="flex items-center gap-2 pt-2 border-t border-fm-border">
        <button
          onClick={onViewAnalysis}
          className="w-full px-3 py-1.5 text-xs font-medium text-fm-accent bg-fm-accent-soft border border-fm-accent-border rounded hover:bg-fm-accent-soft transition-colors"
          aria-label="View analysis details"
        >
          View Analysis
        </button>
      </div>
    </div>
  );
});

EvidenceItem.displayName = 'EvidenceItem';

/**
 * Helper function to determine source information
 */
function getSourceInfo(item: UploadedData): { icon: string; label: string; url?: string } {
  // Prefer explicit source_type field (set by backend since unified turn API)
  const sourceType = (item as any).source_type as string | undefined;

  if (sourceType === 'page_capture' || item.filename?.startsWith('page-capture-')) {
    return { icon: '🌐', label: 'Page captured' };
  }
  if (sourceType === 'text_paste' || item.filename?.startsWith('pasted-content-')) {
    return { icon: '📝', label: 'Pasted content' };
  }
  // file_upload or any unrecognised source — treat as file
  return { icon: '📄', label: 'File uploaded' };
}
