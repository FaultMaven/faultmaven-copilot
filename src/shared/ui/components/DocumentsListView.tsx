import React, { useState, useEffect, useMemo } from "react";
import { KnowledgeDocument, DocumentType } from "../../../lib/api";
import { normalizeTags } from "../../../lib/utils/safe-tags";
import DocumentRowEnhanced from "./DocumentRowEnhanced";

interface DocumentsListViewProps {
  documents: KnowledgeDocument[];
  totalCount: number;
  loading: boolean;
  currentPage: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onFiltersChange: (filters: {
    documentType?: DocumentType;
    tags?: string[];
    textSearch?: string;
  }) => void;
  onEdit: (document: KnowledgeDocument) => void;
  onDelete: (documentId: string) => void;
  onView: (document: KnowledgeDocument) => void;
}

const DOCUMENT_TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: 'playbook', label: 'Playbook' },
  { value: 'troubleshooting_guide', label: 'Troubleshooting Guide' },
  { value: 'reference', label: 'Reference' },
  { value: 'how_to', label: 'How-To' }
];

export default function DocumentsListView({
  documents,
  totalCount,
  loading,
  currentPage,
  pageSize,
  onPageChange,
  onFiltersChange,
  onEdit,
  onDelete,
  onView
}: DocumentsListViewProps) {
  const [textSearch, setTextSearch] = useState("");
  const [selectedDocumentType, setSelectedDocumentType] = useState<DocumentType | "">("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  // Extract all unique tags from documents
  useEffect(() => {
    const tagSet = new Set<string>();
    documents.forEach(doc => {
      normalizeTags(doc.tags).forEach(tag => tagSet.add(tag));
    });
    setAvailableTags(Array.from(tagSet).sort());
  }, [documents]);

  // Debounced filter application
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      onFiltersChange({
        documentType: selectedDocumentType || undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        textSearch: textSearch.trim() || undefined
      });
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [textSearch, selectedDocumentType, selectedTags, onFiltersChange]);

  // Client-side filtering for text search (as specified in requirements)
  const filteredDocuments = useMemo(() => {
    if (!textSearch.trim()) return documents;
    
    const searchTerm = textSearch.toLowerCase();
    return documents.filter(doc => 
      doc.title?.toLowerCase().includes(searchTerm)
    );
  }, [documents, textSearch]);

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const clearFilters = () => {
    setTextSearch("");
    setSelectedDocumentType("");
    setSelectedTags([]);
  };

  const hasActiveFilters = textSearch || selectedDocumentType || selectedTags.length > 0;

  const totalPages = Math.ceil(totalCount / pageSize);
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalCount);

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center justify-center space-x-2">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
          <span className="text-sm text-gray-600">Loading documents...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      {/* Header with Filters */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-700">
            Documents ({totalCount})
          </h3>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Filters Row */}
        <div className="space-y-3">
          {/* Text Search */}
          <div>
            <label htmlFor="document-search" className="sr-only">
              Search documents by title
            </label>
            <input
              id="document-search"
              type="text"
              placeholder="Search by title..."
              value={textSearch}
              onChange={(e) => setTextSearch(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              aria-describedby="search-description"
            />
            <div id="search-description" className="sr-only">
              Type to filter documents by title. Results will appear as you type.
            </div>
          </div>

          {/* Type and Tags Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Document Type Filter */}
            <div>
              <label htmlFor="document-type-filter" className="sr-only">
                Filter by document type
              </label>
              <select
                id="document-type-filter"
                value={selectedDocumentType}
                onChange={(e) => setSelectedDocumentType(e.target.value as DocumentType)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                aria-label="Filter documents by type"
              >
                <option value="">All types</option>
                {DOCUMENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Tags Filter */}
            <div className="relative">
              <div className="flex flex-wrap gap-1 p-2 border border-gray-300 rounded-md min-h-[2.5rem]">
                {selectedTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800"
                  >
                    {tag}
                    <button
                      onClick={() => handleTagToggle(tag)}
                      className="ml-1 text-blue-600 hover:text-blue-800"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <select
                  value=""
                  onChange={(e) => e.target.value && handleTagToggle(e.target.value)}
                  className="flex-1 min-w-0 border-none outline-none text-sm bg-transparent"
                >
                  <option value="">
                    {selectedTags.length === 0 ? "Filter by tags..." : "Add tag..."}
                  </option>
                  {availableTags
                    .filter(tag => !selectedTags.includes(tag))
                    .map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Documents Table */}
      {filteredDocuments.length === 0 ? (
        <div className="p-6 text-center">
          <div className="mx-auto w-12 h-12 text-gray-300 mb-3">
            <svg
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-gray-900 mb-1">
            {hasActiveFilters ? "No matching documents" : "No documents yet"}
          </h3>
          <p className="text-xs text-gray-500">
            {hasActiveFilters 
              ? "Try adjusting your filters or search terms"
              : "Upload your first document to get started with the knowledge base"
            }
          </p>
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full divide-y divide-gray-200" style={{ minWidth: '800px' }}>
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '200px', minWidth: '200px' }}>
                    Title
                  </th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    Type
                  </th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    Tags
                  </th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '100px', minWidth: '100px' }}>
                    Category
                  </th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                    Created
                  </th>
                  <th className="px-2 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider" style={{ width: '140px', minWidth: '140px' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredDocuments.map((document) => (
                  <DocumentRowEnhanced
                    key={document.document_id}
                    document={document}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onView={onView}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-700">
                  Showing {startItem} to {endItem} of {totalCount} documents
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => onPageChange(currentPage - 1)}
                    disabled={currentPage <= 1}
                    className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  
                  <div className="flex items-center space-x-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => onPageChange(pageNum)}
                          className={`px-2 py-1 text-xs border rounded ${
                            pageNum === currentPage
                              ? 'border-blue-500 bg-blue-50 text-blue-600'
                              : 'border-gray-300 hover:bg-gray-100'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => onPageChange(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                    className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}