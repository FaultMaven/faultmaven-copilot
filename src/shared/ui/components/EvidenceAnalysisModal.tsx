import React, { memo } from 'react';
import { UploadedData, formatFileSize, formatDataType } from '../../../lib/api';

interface EvidenceAnalysisModalProps {
  evidence: UploadedData | null;
  isOpen: boolean;
  onClose: () => void;
  onQueryThis?: (evidence: UploadedData) => void;
}

/**
 * Evidence Analysis Modal
 *
 * Displays detailed analysis for uploaded/pasted/injected evidence:
 * - Summary of data
 * - Key findings from AI analysis
 * - Relevance to case
 * - Action buttons (Close, Query This)
 *
 * Phase 3 Week 7: Evidence Management
 */
export const EvidenceAnalysisModal: React.FC<EvidenceAnalysisModalProps> = memo(({
  evidence,
  isOpen,
  onClose,
  onQueryThis
}) => {
  if (!isOpen || !evidence) {
    return null;
  }

  // Extract analysis data
  const classification = evidence.classification;
  const summary = evidence.agent_response || 'No analysis available';

  // Format timestamp
  const uploadedDate = new Date(evidence.uploaded_at);
  const formattedDateTime = uploadedDate.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  // Handle click outside modal to close
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Handle Query This button
  const handleQueryThis = () => {
    if (onQueryThis && evidence) {
      onQueryThis(evidence);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-modal-title"
    >
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 id="evidence-modal-title" className="text-lg font-semibold text-gray-900">
            Analysis: {evidence.filename || 'Pasted Content'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close modal"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Metadata Section */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <span className="font-medium text-gray-700">Uploaded:</span>
                <span className="ml-2 text-gray-600">{formattedDateTime}</span>
              </div>
              {evidence.file_size && (
                <div>
                  <span className="font-medium text-gray-700">Size:</span>
                  <span className="ml-2 text-gray-600">{formatFileSize(evidence.file_size)}</span>
                </div>
              )}
              {classification && (
                <div>
                  <span className="font-medium text-gray-700">Type:</span>
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                    {formatDataType(classification.data_type)}
                  </span>
                </div>
              )}
              {classification && classification.confidence && (
                <div>
                  <span className="font-medium text-gray-700">Confidence:</span>
                  <span className="ml-2 text-gray-600">
                    {Math.round(classification.confidence * 100)}%
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Summary Section */}
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-2">
              <span className="text-base" aria-hidden="true">📊</span>
              Summary
            </h3>
            <div className="prose prose-sm max-w-none text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="whitespace-pre-wrap">{summary}</p>
            </div>
          </div>

          {/* Processing Info (if available) */}
          {classification?.processing_time_ms && (
            <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-2">
              <span className="font-medium">Processing time:</span> {classification.processing_time_ms}ms
              {classification.compression_ratio && classification.compression_ratio > 1.5 && (
                <span className="ml-3">
                  <span className="font-medium">Compression:</span> {classification.compression_ratio.toFixed(1)}x
                </span>
              )}
            </div>
          )}
        </div>

        {/* Footer - Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          {onQueryThis && (
            <button
              onClick={handleQueryThis}
              className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
            >
              Query This
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
});

EvidenceAnalysisModal.displayName = 'EvidenceAnalysisModal';
