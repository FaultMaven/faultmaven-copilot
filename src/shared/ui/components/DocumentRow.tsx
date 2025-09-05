import React, { useState } from "react";
import { KbDocument } from "../../../lib/api";
import { normalizeTags } from "../../../lib/utils/safe-tags";

interface DocumentRowProps {
  document: KbDocument;
  onDelete: (id: string) => void;
}

export default function DocumentRow({ document, onDelete }: DocumentRowProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (window.confirm(`Are you sure you want to delete "${document.title}"?`)) {
      setIsDeleting(true);
      try {
        await onDelete(document.document_id);
      } finally {
        setIsDeleting(false);
      }
    }
  };

  const getStatusBadge = (status: string) => {
    const baseClasses = "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium";
    
    // Handle undefined or null status
    const safeStatus = status?.toLowerCase() || 'unknown';
    
    switch (safeStatus) {
      case 'indexed':
      case 'processed':
        return (
          <span className={`${baseClasses} bg-green-100 text-green-800`}>
            <div className="w-1.5 h-1.5 bg-green-400 rounded-full mr-1.5"></div>
            {status || 'Processed'}
          </span>
        );
      case 'processing':
        return (
          <span className={`${baseClasses} bg-yellow-100 text-yellow-800`}>
            <div className="w-1.5 h-1.5 bg-yellow-400 rounded-full mr-1.5 animate-pulse"></div>
            Processing
          </span>
        );
      case 'error':
        return (
          <span className={`${baseClasses} bg-red-100 text-red-800`}>
            <div className="w-1.5 h-1.5 bg-red-400 rounded-full mr-1.5"></div>
            Error
          </span>
        );
      default:
        return (
          <span className={`${baseClasses} bg-gray-100 text-gray-800`}>
            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mr-1.5"></div>
            {status || 'Unknown'}
          </span>
        );
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getFileIcon = (documentType: string) => {
    // Handle undefined or null documentType  
    const safeDocumentType = documentType?.toLowerCase() || 'unknown';
    
    switch (safeDocumentType) {
      case 'pdf':
        return (
          <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
        );
      case 'docx':
      case 'document':
        return (
          <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
        );
      case 'md':
      case 'markdown':
        return (
          <svg className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
        );
      case 'troubleshooting_guide':
        return (
          <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" clipRule="evenodd" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
        );
    }
  };

  const formatDocumentType = (documentType: string) => {
    // Handle undefined or null documentType
    if (!documentType) return 'Unknown';
    
    return documentType
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <tr className="hover:bg-gray-50">
      {/* Title */}
      <td className="px-3 py-3" style={{ width: '200px', minWidth: '200px' }}>
        <div className="flex items-center">
          <div className="flex-shrink-0 mr-2">
            {getFileIcon(document.document_type)}
          </div>
          <div className="text-sm font-medium text-gray-900 truncate">
            {document.title}
          </div>
        </div>
      </td>

      {/* Document Type */}
      <td className="px-2 py-3 whitespace-nowrap text-xs text-gray-500" style={{ width: '120px', minWidth: '120px' }}>
        {formatDocumentType(document.document_type)}
      </td>

      {/* Status */}
      <td className="px-2 py-3 whitespace-nowrap" style={{ width: '100px', minWidth: '100px' }}>
        {getStatusBadge(document.status)}
      </td>

      {/* Tags */}
      <td className="px-2 py-3 whitespace-nowrap" style={{ width: '120px', minWidth: '120px' }}>
        <div className="flex flex-wrap gap-1">
          {(() => {
            const tags = normalizeTags(document.tags);
            return tags.length > 0 ? (
              <>
                {tags.slice(0, 1).map((tag, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                  >
                    {tag}
                  </span>
                ))}
                {tags.length > 1 && (
                  <span className="text-xs text-gray-500">
                    +{tags.length - 1}
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-gray-400">-</span>
            );
          })()}
        </div>
      </td>

      {/* Date Added */}
      <td className="px-2 py-3 whitespace-nowrap text-xs text-gray-500" style={{ width: '140px', minWidth: '140px' }}>
        {formatDate(document.created_at)}
      </td>

      {/* Delete Button */}
      <td className="px-2 py-3 whitespace-nowrap text-right" style={{ width: '120px', minWidth: '120px' }}>
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="inline-flex items-center px-2 py-1 border border-transparent text-xs leading-4 font-medium rounded text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Delete document"
        >
          {isDeleting ? (
            <div className="animate-spin rounded-full h-3 w-3 border-b border-white"></div>
          ) : (
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          )}
        </button>
      </td>
    </tr>
  );
} 