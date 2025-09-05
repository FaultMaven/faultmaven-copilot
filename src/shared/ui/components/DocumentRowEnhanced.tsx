import React, { useState } from "react";
import { KnowledgeDocument } from "../../../lib/api";
import { normalizeTags } from "../../../lib/utils/safe-tags";

interface DocumentRowEnhancedProps {
  document: KnowledgeDocument;
  onEdit: (document: KnowledgeDocument) => void;
  onDelete: (documentId: string) => void;
  onView: (document: KnowledgeDocument) => void;
}

export default function DocumentRowEnhanced({ 
  document, 
  onEdit, 
  onDelete, 
  onView 
}: DocumentRowEnhancedProps) {
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

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown';
    
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
    } else if (diffInHours < 24 * 7) {
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit'
      });
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
      });
    }
  };

  const getFileIcon = (documentType: string) => {
    const safeDocumentType = documentType?.toLowerCase() || 'unknown';
    
    switch (safeDocumentType) {
      case 'playbook':
        return (
          <svg className="w-4 h-4 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case 'how_to':
        return (
          <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
        );
      case 'reference':
        return (
          <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
          </svg>
        );
      case 'troubleshooting_guide':
        return (
          <svg className="w-4 h-4 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
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
          <div>
            <div className="text-sm font-medium text-gray-900 truncate" title={document.title}>
              {document.title}
            </div>
            {document.description && (
              <div className="text-xs text-gray-500 truncate mt-0.5" title={document.description}>
                {document.description}
              </div>
            )}
          </div>
        </div>
      </td>

      {/* Document Type */}
      <td className="px-2 py-3 whitespace-nowrap text-xs text-gray-500" style={{ width: '120px', minWidth: '120px' }}>
        {formatDocumentType(document.document_type)}
      </td>

      {/* Tags */}
      <td className="px-2 py-3 whitespace-nowrap" style={{ width: '120px', minWidth: '120px' }}>
        <div className="flex flex-wrap gap-1">
          {(() => {
            const tags = normalizeTags(document.tags);
            const isStringTags = typeof document.tags === 'string' && document.tags.trim();
            
            return tags.length > 0 ? (
              <>
                {tags.slice(0, 2).map((tag, index) => (
                  <span
                    key={index}
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                      isStringTags 
                        ? 'bg-yellow-100 text-yellow-800 border border-yellow-300' 
                        : 'bg-blue-100 text-blue-800'
                    }`}
                    title={isStringTags ? `${tag} (API inconsistency: tags returned as string)` : tag}
                  >
                    {tag.length > 10 ? `${tag.substring(0, 10)}...` : tag}
                  </span>
                ))}
                {tags.length > 2 && (
                  <span 
                    className="text-xs text-gray-500"
                    title={`Additional tags: ${tags.slice(2).join(', ')}`}
                  >
                    +{tags.length - 2}
                  </span>
                )}
                {isStringTags && (
                  <span 
                    className="text-xs text-yellow-600 ml-1"
                    title="Backend API inconsistency: tags returned as string instead of array"
                  >
                    ⚠️
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-gray-400">-</span>
            );
          })()}
        </div>
      </td>

      {/* Category */}
      <td className="px-2 py-3 whitespace-nowrap text-xs text-gray-500" style={{ width: '100px', minWidth: '100px' }}>
        <span className="truncate" title={document.category}>
          {document.category || '-'}
        </span>
      </td>

      {/* Created Date (relative) */}
      <td className="px-2 py-3 whitespace-nowrap text-xs text-gray-500" style={{ width: '120px', minWidth: '120px' }}>
        <span title={document.created_at ? new Date(document.created_at).toLocaleString() : 'Unknown'}>
          {formatDate(document.created_at)}
        </span>
      </td>

      {/* Actions */}
      <td className="px-2 py-3 whitespace-nowrap text-right" style={{ width: '140px', minWidth: '140px' }}>
        <div className="flex items-center justify-end space-x-2">
          {/* View Button */}
          <button
            onClick={() => onView(document)}
            className="inline-flex items-center px-2 py-1 border border-gray-300 text-xs leading-4 font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            title="View document details"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>

          {/* Edit Button */}
          <button
            onClick={() => onEdit(document)}
            className="inline-flex items-center px-2 py-1 border border-gray-300 text-xs leading-4 font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            title="Edit metadata"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          {/* Delete Button */}
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="inline-flex items-center px-2 py-1 border border-transparent text-xs leading-4 font-medium rounded text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
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
        </div>
      </td>
    </tr>
  );
}