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
  // Only show when expanded and has evidence
  if (!isExpanded || evidence.length === 0) {
    return null;
  }

  return (
    <div className="evidence-panel border-b border-gray-200 bg-gray-50">
      {/* Evidence List - No header (header is in CaseHeader) */}
      <div id="evidence-list" className="px-4 py-4 space-y-3">
        {evidence.map((item) => (
          <EvidenceItem
            key={item.data_id}
            item={item}
            onViewAnalysis={() => onViewAnalysis(item)}
          />
        ))}
      </div>
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

  // Format timestamp
  const uploadedDate = new Date(item.uploaded_at);
  const formattedDate = uploadedDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const formattedTime = uploadedDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  return (
    <div
      className="evidence-item bg-white border border-gray-200 rounded-lg p-3 hover:shadow-md transition-shadow"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="article"
      aria-label={`Evidence: ${item.filename || 'content'}`}
    >
      {/* Header Row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-base flex-shrink-0" aria-hidden="true">{sourceInfo.icon}</span>
          <h3 className="text-sm font-semibold text-gray-900 truncate">
            {item.filename || `Content (${item.data_id.substring(0, 7)})`}
          </h3>
          {item.file_size && (
            <span className="text-xs text-gray-500 flex-shrink-0">
              ({formatFileSize(item.file_size)})
            </span>
          )}
        </div>
      </div>

      {/* Metadata Row */}
      <div className="text-xs text-gray-600 mb-2 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{sourceInfo.label}:</span>
          <span>{formattedDate}, {formattedTime}</span>
        </div>

        {sourceInfo.url && (
          <div className="flex items-center gap-2 truncate">
            <span className="font-medium">From:</span>
            <a
              href={sourceInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline truncate"
            >
              {sourceInfo.url}
            </a>
          </div>
        )}

        {/* Data Type Classification */}
        {item.classification && (
          <div className="flex items-center gap-2">
            <span className="font-medium">Type:</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
              {formatDataType(item.classification.data_type)}
            </span>
          </div>
        )}

        {/* Status */}
        <div className="flex items-center gap-2">
          <span className="font-medium">Status:</span>
          <span className="inline-flex items-center gap-1 text-green-700">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Analyzed
          </span>
        </div>
      </div>

      {/* Action Button */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
        <button
          onClick={onViewAnalysis}
          className="w-full px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
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
  // Determine from filename
  if (item.filename) {
    if (item.filename.startsWith('page-content-')) {
      return {
        icon: '📊',
        label: 'Page captured'
      };
    }
    if (item.filename.startsWith('text-data-')) {
      return {
        icon: '📝',
        label: 'Text submitted'
      };
    }
    return {
      icon: '📄',
      label: 'File uploaded'
    };
  }

  // Default for text content
  return {
    icon: '📝',
    label: 'Content provided'
  };
}
