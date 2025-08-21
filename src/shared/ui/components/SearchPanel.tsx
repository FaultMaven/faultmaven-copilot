import React, { useState } from "react";
import { DocumentType } from "../../../lib/api";

interface SearchResult {
  document_id: string;
  content: string;
  metadata: {
    title: string;
    document_type: DocumentType;
    category?: string;
    tags: string[];
    priority?: number;
  };
  similarity_score: number;
}

interface SearchPanelProps {
  onSearch: (query: string, filters?: {
    documentType?: DocumentType;
    category?: string;
    similarityThreshold?: number;
    limit?: number;
  }) => Promise<void>;
  searchResults: SearchResult[];
  isSearching: boolean;
  onOpenDocument: (documentId: string) => void;
}

const DOCUMENT_TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: 'playbook', label: 'Playbook' },
  { value: 'troubleshooting_guide', label: 'Troubleshooting Guide' },
  { value: 'reference', label: 'Reference' },
  { value: 'how_to', label: 'How-To' }
];

export default function SearchPanel({
  onSearch,
  searchResults,
  isSearching,
  onOpenDocument
}: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType | "">("");
  const [category, setCategory] = useState("");
  const [similarityThreshold, setSimilarityThreshold] = useState(0.7);
  const [limit, setLimit] = useState(5);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!query.trim()) return;

    const filters = {
      documentType: documentType || undefined,
      category: category.trim() || undefined,
      similarityThreshold,
      limit
    };

    await onSearch(query.trim(), filters);
  };

  const formatDocumentType = (documentType: string) => {
    if (!documentType) return 'Unknown';
    
    return documentType
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const truncateContent = (content: string, maxLength: number = 200) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.8) return 'text-green-600 bg-green-100';
    if (score >= 0.6) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Semantic Search</h3>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Query Input */}
        <div>
          <label htmlFor="search-query" className="block text-xs font-medium text-gray-700 mb-1">
            Search Query *
          </label>
          <textarea
            id="search-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            placeholder="Describe what you're looking for..."
            disabled={isSearching}
            required
          />
        </div>

        {/* Filters Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Document Type Filter */}
          <div>
            <label htmlFor="search-doc-type" className="block text-xs font-medium text-gray-700 mb-1">
              Document Type
            </label>
            <select
              id="search-doc-type"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as DocumentType)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isSearching}
            >
              <option value="">All types</option>
              {DOCUMENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div>
            <label htmlFor="search-category" className="block text-xs font-medium text-gray-700 mb-1">
              Category
            </label>
            <input
              id="search-category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Filter by category..."
              disabled={isSearching}
            />
          </div>
        </div>

        {/* Advanced Options */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Similarity Threshold */}
          <div>
            <label htmlFor="similarity-threshold" className="block text-xs font-medium text-gray-700 mb-1">
              Similarity Threshold: {similarityThreshold.toFixed(1)}
            </label>
            <input
              id="similarity-threshold"
              type="range"
              min="0.0"
              max="1.0"
              step="0.1"
              value={similarityThreshold}
              onChange={(e) => setSimilarityThreshold(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              disabled={isSearching}
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Less strict</span>
              <span>More strict</span>
            </div>
          </div>

          {/* Result Limit */}
          <div>
            <label htmlFor="search-limit" className="block text-xs font-medium text-gray-700 mb-1">
              Max Results
            </label>
            <select
              id="search-limit"
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isSearching}
            >
              <option value={5}>5 results</option>
              <option value={10}>10 results</option>
              <option value={15}>15 results</option>
              <option value={20}>20 results</option>
            </select>
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!query.trim() || isSearching}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSearching ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              Searching...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Search Knowledge Base
            </>
          )}
        </button>
      </form>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="mt-6 border-t border-gray-200 pt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-3">
            Search Results ({searchResults.length})
          </h4>
          <div className="space-y-3">
            {searchResults.map((result) => (
              <div
                key={result.document_id}
                className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => onOpenDocument(result.document_id)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <h5 className="text-sm font-medium text-gray-900 mb-1">
                      {result.metadata.title}
                    </h5>
                    <div className="flex items-center space-x-2 text-xs text-gray-500">
                      <span>{formatDocumentType(result.metadata.document_type)}</span>
                      {result.metadata.category && (
                        <>
                          <span>•</span>
                          <span>{result.metadata.category}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className={`px-2 py-1 rounded text-xs font-medium ${getScoreColor(result.similarity_score)}`}>
                    {(result.similarity_score * 100).toFixed(0)}%
                  </div>
                </div>

                <p className="text-xs text-gray-700 mb-2">
                  {truncateContent(result.content)}
                </p>

                {result.metadata.tags && result.metadata.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {result.metadata.tags.slice(0, 3).map((tag, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                      >
                        {tag}
                      </span>
                    ))}
                    {result.metadata.tags.length > 3 && (
                      <span className="text-xs text-gray-500">
                        +{result.metadata.tags.length - 3} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}