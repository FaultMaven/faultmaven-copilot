import React, { useState, useEffect } from "react";
import UploadArea from "./components/UploadArea";
import DocumentTable from "./components/DocumentTable";
import { ErrorState } from "./components/ErrorState";
import { 
  uploadKnowledgeDocument, 
  getKnowledgeDocuments, 
  deleteKnowledgeDocument,
  searchKnowledgeBase,
  KbDocument
} from "../../lib/api";

interface KnowledgeBaseViewProps {
  serverError?: string | null;
  onRetry?: () => void;
}

export default function KnowledgeBaseView({ serverError, onRetry }: KnowledgeBaseViewProps) {
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KbDocument[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);

  const fetchDocuments = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const docs = await getKnowledgeDocuments();
      // Ensure docs is an array
      setDocuments(Array.isArray(docs) ? docs : []);
    } catch (err: any) {
      console.error("[KnowledgeBaseView] Error fetching documents:", err);
      setError('Could not load documents. Please check your connection and try again.');
      setDocuments([]); // Reset to empty array on error
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleUpload = async (files: File[]) => {
    setError(null);
    const newDocuments: KbDocument[] = [];

    // Optimistically add files with "Processing" status
    for (const file of files) {
      const newDoc: KbDocument = {
        document_id: `temp-${Date.now()}-${Math.random()}`,
        title: file.name,
        content: '', // Will be populated by the API
        document_type: 'troubleshooting_guide',
        status: 'Processing',
        tags: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      newDocuments.push(newDoc);
    }

    setDocuments(prev => [...newDocuments, ...prev]);

    // Upload each file
    for (let i = 0; i < files.length; i++) {
      try {
        const uploadedDoc = await uploadKnowledgeDocument(
          files[i],
          files[i].name,
          'troubleshooting_guide'
        );
        // Replace the temporary document with the real one
        setDocuments(prev => prev.map(doc => 
          doc.document_id === newDocuments[i].document_id ? uploadedDoc : doc
        ));
      } catch (err: any) {
        console.error(`[KnowledgeBaseView] Error uploading ${files[i].name}:`, err);
        // Update the document status to Error
        setDocuments(prev => prev.map(doc => 
          doc.document_id === newDocuments[i].document_id 
            ? { ...doc, status: 'Error' }
            : doc
        ));
        setError(`Failed to upload ${files[i].name}: ${err.message}`);
      }
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteKnowledgeDocument(id);
      setDocuments(prev => prev.filter(doc => doc.document_id !== id));
      // Also remove from search results if present
      setSearchResults(prev => Array.isArray(prev) ? prev.filter(doc => doc && doc.document_id !== id) : []);
    } catch (err: any) {
      console.error("[KnowledgeBaseView] Error deleting document:", err);
      setError(`Failed to delete document: ${err.message}`);
    }
  };

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setShowSearchResults(false);
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const results = await searchKnowledgeBase(query, undefined, undefined, undefined, 20);
      // Ensure results is an array
      setSearchResults(Array.isArray(results) ? results : []);
      setShowSearchResults(true);
    } catch (err: any) {
      console.error("[KnowledgeBaseView] Search error:", err);
      setError(`Search failed: ${err.message}`);
      setSearchResults([]);
      setShowSearchResults(false);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    
    // Debounced search
    const timeoutId = setTimeout(() => {
      if (query.trim()) {
        handleSearch(query);
      } else {
        setShowSearchResults(false);
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  };

  const clearSearch = () => {
    setSearchQuery("");
    setShowSearchResults(false);
    setSearchResults([]);
  };

  // Show server error if present
  if (serverError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <div className="mb-4">
            <svg className="w-12 h-12 text-red-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-red-600 font-medium mb-2">Server Connection Error</p>
            <p className="text-sm text-gray-600 mb-4">{serverError}</p>
            {onRetry && (
              <button 
                onClick={onRetry}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
              >
                Retry Connection
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Knowledge Base</h2>
        <p className="text-sm text-gray-600">
          Upload documents to build your offline knowledge base for AI-powered troubleshooting.
        </p>
      </div>

      {/* Search Bar */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
        <div className="relative">
          <input
            type="text"
            placeholder="Search knowledge base..."
            value={searchQuery}
            onChange={handleSearchInputChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          )}
        </div>
        {isSearching && (
          <div className="mt-2 text-sm text-gray-600 flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            Searching...
          </div>
        )}
      </div>

      {/* Upload Area */}
      <UploadArea onUpload={handleUpload} />

      {/* Document Table or Error State */}
      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-center space-x-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              <span className="text-sm text-gray-600">Loading documents...</span>
            </div>
          </div>
        ) : error ? (
          <ErrorState 
            message={error} 
            onRetry={fetchDocuments}
            title="Could not load documents"
          />
        ) : (
          <>
            {showSearchResults && searchResults.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm mb-4">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">
                    Search Results ({searchResults.length})
                  </h3>
                  <button
                    onClick={clearSearch}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Clear Search
                  </button>
                </div>
                <DocumentTable 
                  documents={searchResults} 
                  onDelete={handleDelete}
                  loading={false}
                />
              </div>
            )}
            
            {!showSearchResults && (
              <DocumentTable 
                documents={documents} 
                onDelete={handleDelete}
                loading={false}
              />
            )}
            
            {showSearchResults && searchResults.length === 0 && !isSearching && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm text-center">
                <p className="text-sm text-gray-600">No documents found matching "{searchQuery}"</p>
                <button
                  onClick={clearSearch}
                  className="mt-2 text-xs text-blue-600 hover:text-blue-800 underline"
                >
                  View all documents
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
} 