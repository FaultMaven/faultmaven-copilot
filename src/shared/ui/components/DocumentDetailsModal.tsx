import React from "react";
import { KnowledgeDocument } from "../../../lib/api";
import { normalizeTags } from "../../../lib/utils/safe-tags";

interface DocumentDetailsModalProps {
  document: KnowledgeDocument | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit: (document: KnowledgeDocument) => void;
}

export default function DocumentDetailsModal({
  document,
  isOpen,
  onClose,
  onEdit
}: DocumentDetailsModalProps) {
  if (!isOpen || !document) return null;

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleString();
  };

  const formatDocumentType = (documentType: string) => {
    if (!documentType) return 'Unknown';
    
    return documentType
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" onKeyDown={handleKeyDown}>
      <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={onClose}
        ></div>

        {/* Modal */}
        <div className="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-2xl">
          {/* Header */}
          <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-medium leading-6 text-gray-900 mb-2">
                  {document.title}
                </h3>
                <div className="flex items-center space-x-4 text-sm text-gray-500">
                  <span>{formatDocumentType(document.document_type)}</span>
                  {document.category && (
                    <>
                      <span>•</span>
                      <span>{document.category}</span>
                    </>
                  )}
                  <span>•</span>
                  <span>Created {formatDate(document.created_at)}</span>
                </div>
              </div>
              <div className="flex items-center space-x-2 ml-4">
                <button
                  onClick={() => onEdit(document)}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit
                </button>
                <button
                  onClick={onClose}
                  className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="mt-6 space-y-6">
              {/* Description */}
              {document.description && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Description</h4>
                  <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg">
                    {document.description}
                  </p>
                </div>
              )}

              {/* Tags */}
              {(() => {
                const tags = normalizeTags(document.tags);
                return tags.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-medium text-gray-900 mb-2">Tags</h4>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null;
              })()}

              {/* Source URL */}
              {document.source_url && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Source URL</h4>
                  <a
                    href={document.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-800 underline break-all"
                  >
                    {document.source_url}
                  </a>
                </div>
              )}

              {/* Content Preview */}
              {document.content && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Content Preview</h4>
                  <div className="bg-gray-50 p-4 rounded-lg max-h-64 overflow-y-auto">
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">
                      {document.content.length > 1000 
                        ? `${document.content.substring(0, 1000)}...` 
                        : document.content
                      }
                    </pre>
                  </div>
                  {document.content.length > 1000 && (
                    <p className="text-xs text-gray-500 mt-2">
                      Content truncated. Showing first 1000 characters.
                    </p>
                  )}
                </div>
              )}

              {/* Metadata */}
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-3">Document Information</h4>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-medium text-gray-500">Document ID</dt>
                    <dd className="mt-1 text-xs text-gray-900 font-mono break-all">
                      {document.document_id}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-gray-500">Type</dt>
                    <dd className="mt-1 text-xs text-gray-900">
                      {formatDocumentType(document.document_type)}
                    </dd>
                  </div>
                  {document.category && (
                    <div>
                      <dt className="text-xs font-medium text-gray-500">Category</dt>
                      <dd className="mt-1 text-xs text-gray-900">{document.category}</dd>
                    </div>
                  )}
                  {document.status && (
                    <div>
                      <dt className="text-xs font-medium text-gray-500">Status</dt>
                      <dd className="mt-1 text-xs text-gray-900">{document.status}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs font-medium text-gray-500">Created</dt>
                    <dd className="mt-1 text-xs text-gray-900">
                      {formatDate(document.created_at)}
                    </dd>
                  </div>
                  {document.updated_at && document.updated_at !== document.created_at && (
                    <div>
                      <dt className="text-xs font-medium text-gray-500">Last Updated</dt>
                      <dd className="mt-1 text-xs text-gray-900">
                        {formatDate(document.updated_at)}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:w-auto"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}