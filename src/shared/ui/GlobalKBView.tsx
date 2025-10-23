/**
 * Global Knowledge Base Management View (Admin Only)
 *
 * This component allows admin users to manage the system-wide knowledge base.
 * Regular users see only their personal KB via KnowledgeBaseView.
 */

import React, { useState, useEffect, useCallback } from "react";
import { ErrorState } from "./components/ErrorState";
import UploadPanel from "./components/UploadPanel";
import DocumentsListView from "./components/DocumentsListView";
import EditMetadataModal from "./components/EditMetadataModal";
import DocumentDetailsModal from "./components/DocumentDetailsModal";
import SearchPanel from "./components/SearchPanel";
import {
  uploadKnowledgeDocument,     // Global KB endpoints
  getKnowledgeDocuments,
  deleteKnowledgeDocument,
  updateKnowledgeDocument,
  getKnowledgeDocument,
  searchKnowledgeBase,
  KnowledgeDocument,
  DocumentListResponse,
  DocumentType
} from "../../lib/api";
import { useAuth } from "./hooks/useAuth";

interface GlobalKBViewProps {
  serverError?: string | null;
  onRetry?: () => void;
  className?: string;
}

export default function GlobalKBView({ serverError, onRetry, className = '' }: GlobalKBViewProps) {
  const { currentUser, isAdmin } = useAuth();

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

  // Access control - redirect non-admins
  useEffect(() => {
    if (!isAdmin()) {
      setError('Admin access required to manage global knowledge base');
      setIsLoading(false);
    }
  }, [isAdmin]);

  // Fetch global KB documents with filters and pagination
  const fetchDocuments = async () => {
    if (!isAdmin()) {
      console.warn('[GlobalKBView] Non-admin user attempted to fetch global KB');
      setError('Admin access required');
      setIsLoading(false);
      return;
    }

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

      console.log('[GlobalKBView] Fetched global KB documents:', response);

      setDocuments(response.documents || []);
      setTotalCount(response.total_count || 0);
    } catch (err: any) {
      console.error("[GlobalKBView] Error fetching global KB documents:", err);
      setError('Could not load global knowledge base. Please check your connection and try again.');
      setDocuments([]);
      setTotalCount(0);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch documents when switching to documents tab or when filters/pagination change
  useEffect(() => {
    if (activeTab === 'documents' && isAdmin()) {
      fetchDocuments();
    }
  }, [
    activeTab,
    filters.documentType,
    JSON.stringify(filters.tags),
    filters.textSearch,
    currentPage,
    pageSize,
    isAdmin
  ]);

  // Handle upload to global KB (admin only)
  const handleUpload = async (uploadData: {
    file: File;
    title: string;
    documentType: DocumentType;
    tags: string;
    category?: string;
    sourceUrl?: string;
    description?: string;
  }) => {
    if (!isAdmin()) {
      setError('Admin access required to upload to global knowledge base');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      console.log('[GlobalKBView] Uploading document to global KB:', uploadData.title);

      const uploadedDoc = await uploadKnowledgeDocument(
        uploadData.file,
        uploadData.title,
        uploadData.documentType,
        uploadData.category,
        uploadData.tags,
        uploadData.sourceUrl,
        uploadData.description
      );

      console.log('[GlobalKBView] Document uploaded successfully to global KB:', uploadedDoc);

      // Refresh documents to show the new upload
      await fetchDocuments();

      // Switch to documents tab to show the upload
      setActiveTab('documents');

    } catch (err: any) {
      console.error('[GlobalKBView] Upload failed:', err);
      const errorMessage = err.message || err.toString();

      let userFriendlyMessage = `Failed to upload "${uploadData.title}": ${errorMessage}`;
      if (errorMessage.includes('403')) {
        userFriendlyMessage = 'Access denied. Admin privileges required.';
      }

      setError(userFriendlyMessage);
    } finally {
      setIsUploading(false);
    }
  };

  // Handle document deletion from global KB
  const handleDelete = async (documentId: string) => {
    if (!isAdmin()) {
      setError('Admin access required to delete global KB documents');
      return;
    }

    try {
      await deleteKnowledgeDocument(documentId);
      await fetchDocuments(); // Refresh list
    } catch (err: any) {
      console.error("[GlobalKBView] Error deleting document:", err);
      setError(`Failed to delete document: ${err.message}`);
    }
  };

  // Handle document editing
  const handleEdit = (document: KnowledgeDocument) => {
    setEditingDocument(document);
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (documentId: string, updates: any) => {
    if (!isAdmin()) {
      setError('Admin access required to edit global KB documents');
      return;
    }

    setIsEditLoading(true);
    try {
      await updateKnowledgeDocument(documentId, updates);
      setIsEditModalOpen(false);
      await fetchDocuments();
    } catch (err: any) {
      console.error("[GlobalKBView] Error updating document:", err);
      setError(`Failed to update document: ${err.message}`);
    } finally {
      setIsEditLoading(false);
    }
  };

  // Handle document viewing
  const handleView = async (document: KnowledgeDocument) => {
    try {
      // If document has no content, fetch full details
      if (!document.content || document.content.trim() === '') {
        const fullDoc = await getKnowledgeDocument(document.document_id);
        setViewingDocument(fullDoc);
      } else {
        setViewingDocument(document);
      }
      setIsViewModalOpen(true);
    } catch (err: any) {
      console.error("[GlobalKBView] Error fetching document:", err);
      setError(`Failed to load document: ${err.message}`);
    }
  };

  // Handle search
  const handleSearch = async (query: string, filters?: any) => {
    setIsSearching(true);
    setError(null);
    try {
      const results = await searchKnowledgeBase(query, 20, true, 0.7, filters);
      setSearchResults(results.results || []);
    } catch (err: any) {
      console.error("[GlobalKBView] Search failed:", err);
      setError(`Search failed: ${err.message}`);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Show access denied if not admin
  if (!isAdmin()) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center p-8 bg-red-50 rounded-lg border border-red-200">
          <svg className="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-xl font-bold text-red-800 mb-2">Admin Access Required</h2>
          <p className="text-red-700">You need administrator privileges to access the Global Knowledge Base Management.</p>
          <p className="text-sm text-red-600 mt-2">Use the "My Knowledge Base" tab for your personal documents.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header with admin badge */}
      <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 py-4 shadow-md">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Global Knowledge Base Management</h1>
            <p className="text-sm opacity-90 mt-1">System-wide knowledge base for all users</p>
          </div>
          <div className="bg-white bg-opacity-20 px-3 py-1 rounded-full text-sm font-semibold">
            Admin Only
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 bg-white px-6">
        <div className="flex space-x-8">
          <button
            onClick={() => setActiveTab('upload')}
            className={`py-4 px-2 border-b-2 font-medium text-sm ${
              activeTab === 'upload'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Upload Document
          </button>
          <button
            onClick={() => setActiveTab('documents')}
            className={`py-4 px-2 border-b-2 font-medium text-sm ${
              activeTab === 'documents'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Documents ({totalCount})
          </button>
          <button
            onClick={() => setActiveTab('search')}
            className={`py-4 px-2 border-b-2 font-medium text-sm ${
              activeTab === 'search'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Search
          </button>
        </div>
      </div>

      {/* Error Display */}
      {(error || serverError) && (
        <div className="mx-6 mt-4">
          <ErrorState
            message={error || serverError || 'An error occurred'}
            onRetry={() => {
              setError(null);
              if (onRetry) onRetry();
              if (activeTab === 'documents') fetchDocuments();
            }}
          />
        </div>
      )}

      {/* Tab Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'upload' && (
          <div className="p-6">
            <UploadPanel onUpload={handleUpload} isUploading={isUploading} />
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="p-6">
            <DocumentsListView
              documents={documents}
              loading={isLoading}
              onView={handleView}
              onEdit={handleEdit}
              onDelete={handleDelete}
              currentPage={currentPage}
              totalCount={totalCount}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onFiltersChange={setFilters}
            />
          </div>
        )}

        {activeTab === 'search' && (
          <div className="p-6">
            <SearchPanel
              onSearch={handleSearch}
              searchResults={searchResults}
              isSearching={isSearching}
              onOpenDocument={(docId: string) => {
                // Find the document in search results and view it
                const doc = searchResults.find(r => r.document_id === docId);
                if (doc) {
                  handleView(doc as any as KnowledgeDocument);
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Modals */}
      {isEditModalOpen && editingDocument && (
        <EditMetadataModal
          document={editingDocument}
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          onSave={handleSaveEdit}
          isLoading={isEditLoading}
        />
      )}

      {isViewModalOpen && viewingDocument && (
        <DocumentDetailsModal
          document={viewingDocument}
          isOpen={isViewModalOpen}
          onClose={() => setIsViewModalOpen(false)}
          onEdit={handleEdit}
        />
      )}
    </div>
  );
}
