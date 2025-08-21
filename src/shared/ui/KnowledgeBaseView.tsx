import React, { useState, useEffect, useCallback, useRef } from "react";
import { ErrorState } from "./components/ErrorState";
import UploadPanel from "./components/UploadPanel";
import DocumentsListView from "./components/DocumentsListView";
import EditMetadataModal from "./components/EditMetadataModal";
import DocumentDetailsModal from "./components/DocumentDetailsModal";
import SearchPanel from "./components/SearchPanel";
import { 
  uploadKnowledgeDocument, 
  getKnowledgeDocuments, 
  deleteKnowledgeDocument,
  updateKnowledgeDocument,
  getKnowledgeDocument,
  searchKnowledgeBase,
  KnowledgeDocument,
  DocumentListResponse,
  DocumentType
} from "../../lib/api";

interface KnowledgeBaseViewProps {
  serverError?: string | null;
  onRetry?: () => void;
  className?: string;
}

export default function KnowledgeBaseView({ serverError, onRetry, className = '' }: KnowledgeBaseViewProps) {
  // Main state
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(50);
  
  // Filter state
  const [filters, setFilters] = useState<{
    documentType?: DocumentType;
    tags?: string[];
    textSearch?: string;
  }>({});
  
  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  
  // Modal state
  const [editingDocument, setEditingDocument] = useState<KnowledgeDocument | null>(null);
  const [viewingDocument, setViewingDocument] = useState<KnowledgeDocument | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isEditLoading, setIsEditLoading] = useState(false);
  
  // Search state
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<'upload' | 'documents' | 'search'>('upload');

  // Fetch documents with filters and pagination
  const fetchDocuments = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const tagsParam = filters.tags?.join(',') || undefined;
      const offset = (currentPage - 1) * pageSize;
      
      const response: DocumentListResponse = await getKnowledgeDocuments(
        filters.documentType,
        tagsParam,
        pageSize,
        offset
      );
      
      console.log('[KnowledgeBaseView] Fetched documents response:', response);
      
      setDocuments(response.documents || []);
      setTotalCount(response.total_count || 0);
    } catch (err: any) {
      console.error("[KnowledgeBaseView] Error fetching documents:", err);
      setError('Could not load documents. Please check your connection and try again.');
      setDocuments([]);
      setTotalCount(0);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch documents when switching to documents tab or when filters/pagination change
  useEffect(() => {
    if (activeTab === 'documents') {
      fetchDocuments();
    }
  }, [
    activeTab, 
    filters.documentType, 
    JSON.stringify(filters.tags), // Stringify array to avoid reference comparison issues
    filters.textSearch, 
    currentPage, 
    pageSize
  ]);

  // Handle upload with enhanced metadata
  const handleUpload = async (uploadData: {
    file: File;
    title: string;
    documentType: DocumentType;
    tags: string;
    category?: string;
    sourceUrl?: string;
    description?: string;
  }) => {
    setIsUploading(true);
    setError(null);
    
    try {
      console.log('[KnowledgeBaseView] Uploading document:', uploadData.title);
      
      const uploadedDoc = await uploadKnowledgeDocument(
        uploadData.file,
        uploadData.title,
        uploadData.documentType,
        uploadData.category,
        uploadData.tags,
        uploadData.sourceUrl,
        uploadData.description
      );
      
      console.log('[KnowledgeBaseView] Document uploaded successfully:', uploadedDoc);
      
      // Refresh documents to show the new upload
      await fetchDocuments();
      
      // Switch to documents tab to show the upload
      setActiveTab('documents');
      
    } catch (err: any) {
      console.error('[KnowledgeBaseView] Upload failed:', err);
      const errorMessage = err.message || err.toString();
      
      // Provide helpful guidance for common errors
      let userFriendlyMessage = `Failed to upload "${uploadData.title}": ${errorMessage}`;
      if (errorMessage.includes('UTF-8 text content')) {
        userFriendlyMessage += '\n\nNote: PDFs and documents must contain extractable text content. Try text-based formats (TXT, MD, CSV, JSON) for guaranteed compatibility.';
      } else if (errorMessage.includes('Unsupported file type')) {
        userFriendlyMessage += '\n\nSupported file types: MD, TXT, LOG, JSON, CSV, PDF, DOC, DOCX. Make sure your file has the correct extension.';
      }
      
      setError(userFriendlyMessage);
    } finally {
      setIsUploading(false);
    }
  };

  // Handle document deletion
  const handleDelete = async (documentId: string) => {
    try {
      await deleteKnowledgeDocument(documentId);
      await fetchDocuments(); // Refresh list
    } catch (err: any) {
      console.error("[KnowledgeBaseView] Error deleting document:", err);
      setError(`Failed to delete document: ${err.message}`);
    }
  };

  // Handle document editing
  const handleEdit = (document: KnowledgeDocument) => {
    setEditingDocument(document);
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (documentId: string, updates: any) => {
    setIsEditLoading(true);
    try {
      await updateKnowledgeDocument(documentId, updates);
      await fetchDocuments(); // Refresh list
      setIsEditModalOpen(false);
      setEditingDocument(null);
    } catch (err: any) {
      console.error("[KnowledgeBaseView] Error updating document:", err);
      setError(`Failed to update document: ${err.message}`);
    } finally {
      setIsEditLoading(false);
    }
  };

  // Handle document viewing
  const handleView = async (document: KnowledgeDocument) => {
    try {
      // Fetch full document details if content is not available
      const fullDocument = document.content 
        ? document 
        : await getKnowledgeDocument(document.document_id);
      
      setViewingDocument(fullDocument);
      setIsViewModalOpen(true);
    } catch (err: any) {
      console.error("[KnowledgeBaseView] Error fetching document details:", err);
      setError(`Failed to load document details: ${err.message}`);
    }
  };

  // Handle pagination
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  // Handle filters change
  const handleFiltersChange = useCallback((newFilters: {
    documentType?: DocumentType;
    tags?: string[];
    textSearch?: string;
  }) => {
    setFilters(newFilters);
    setCurrentPage(1); // Reset to first page when filters change
  }, []);

  // Handle search
  const handleSearch = async (query: string, searchFilters?: {
    documentType?: DocumentType;
    category?: string;
    similarityThreshold?: number;
    limit?: number;
  }) => {
    setIsSearching(true);
    setError(null);

    try {
      const result = await searchKnowledgeBase(
        query,
        searchFilters?.limit || 10,
        true,
        searchFilters?.similarityThreshold || 0.7,
        {
          category: searchFilters?.category,
          document_type: searchFilters?.documentType
        }
      );
      
      setSearchResults(result.results || []);
    } catch (err: any) {
      console.error("[KnowledgeBaseView] Search error:", err);
      setError(`Search failed: ${err.message}`);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle opening document from search results
  const handleOpenDocument = async (documentId: string) => {
    try {
      const document = await getKnowledgeDocument(documentId);
      setViewingDocument(document);
      setIsViewModalOpen(true);
    } catch (err: any) {
      console.error("[KnowledgeBaseView] Error opening document:", err);
      setError(`Failed to open document: ${err.message}`);
    }
  };

  // Handle duplicate checking for upload
  const handleCheckDuplicates = async (title: string, documentType: DocumentType): Promise<KnowledgeDocument[]> => {
    try {
      // First, get all documents of the same type
      const response = await getKnowledgeDocuments(documentType, undefined, 200, 0);
      
      // Filter for exact title matches (case-insensitive)
      const duplicates = response.documents.filter(doc => 
        doc.title.toLowerCase().trim() === title.toLowerCase().trim() &&
        doc.document_type === documentType
      );
      
      return duplicates;
    } catch (err: any) {
      console.warn("[KnowledgeBaseView] Error checking duplicates:", err);
      return []; // Return empty array on error to avoid blocking upload
    }
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
    <div className={`flex flex-col h-full overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 p-4">
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Knowledge Base</h2>
        <p className="text-sm text-gray-600">
          Upload documents to build your offline knowledge base for AI-powered troubleshooting.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200">
        <div className="flex">
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'upload'
                ? 'border-blue-500 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            Upload
          </button>
          <button
            onClick={() => setActiveTab('documents')}
            className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'documents'
                ? 'border-blue-500 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            Documents ({totalCount})
          </button>
          <button
            onClick={() => setActiveTab('search')}
            className={`flex-1 py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'search'
                ? 'border-blue-500 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            Search
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div className="space-y-4">
            <UploadPanel 
              onUpload={handleUpload} 
              isUploading={isUploading}
              onCheckDuplicates={handleCheckDuplicates}
            />
            {error && (
              <ErrorState 
                message={error} 
                onRetry={() => setError(null)}
                title="Upload Error"
              />
            )}
          </div>
        )}

        {/* Documents Tab */}
        {activeTab === 'documents' && (
          <div>
            {error && (
              <div className="mb-4">
                <ErrorState 
                  message={error} 
                  onRetry={fetchDocuments}
                  title="Could not load documents"
                />
              </div>
            )}
            <DocumentsListView
              documents={documents}
              totalCount={totalCount}
              loading={isLoading}
              currentPage={currentPage}
              pageSize={pageSize}
              onPageChange={handlePageChange}
              onFiltersChange={handleFiltersChange}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onView={handleView}
            />
          </div>
        )}

        {/* Search Tab */}
        {activeTab === 'search' && (
          <div className="space-y-4">
            <SearchPanel
              onSearch={handleSearch}
              searchResults={searchResults}
              isSearching={isSearching}
              onOpenDocument={handleOpenDocument}
            />
            {error && (
              <ErrorState 
                message={error} 
                onRetry={() => setError(null)}
                title="Search Error"
              />
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      <EditMetadataModal
        document={editingDocument}
        isOpen={isEditModalOpen}
        isLoading={isEditLoading}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingDocument(null);
        }}
        onSave={handleSaveEdit}
      />

      <DocumentDetailsModal
        document={viewingDocument}
        isOpen={isViewModalOpen}
        onClose={() => {
          setIsViewModalOpen(false);
          setViewingDocument(null);
        }}
        onEdit={(doc) => {
          setIsViewModalOpen(false);
          setViewingDocument(null);
          handleEdit(doc);
        }}
      />
    </div>
  );
} 