import React, { useState, useEffect } from "react";
import { KnowledgeDocument, DocumentType } from "../../../lib/api";

interface EditMetadataModalProps {
  document: KnowledgeDocument | null;
  isOpen: boolean;
  isLoading: boolean;
  onClose: () => void;
  onSave: (documentId: string, updates: {
    title?: string;
    document_type?: DocumentType;
    tags?: string;
    category?: string;
    version?: string;
    description?: string;
  }) => Promise<void>;
}

const DOCUMENT_TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: 'playbook', label: 'Playbook' },
  { value: 'troubleshooting_guide', label: 'Troubleshooting Guide' },
  { value: 'reference', label: 'Reference' },
  { value: 'how_to', label: 'How-To' }
];

export default function EditMetadataModal({
  document,
  isOpen,
  isLoading,
  onClose,
  onSave
}: EditMetadataModalProps) {
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>('playbook');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [category, setCategory] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");

  // Initialize form when document changes
  useEffect(() => {
    if (document) {
      setTitle(document.title || "");
      
      // Set document type (must be one of the canonical types)
      const validType = DOCUMENT_TYPE_OPTIONS.find(opt => opt.value === document.document_type);
      setDocumentType(validType ? document.document_type as DocumentType : 'playbook');
      
      setTags(Array.isArray(document.tags) ? document.tags : []);
      setCategory(document.category || "");
      setVersion(""); // Version is not stored in the current document structure
      setDescription(document.description || "");
    }
  }, [document]);

  const handleTagAdd = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const trimmedTag = tagInput.trim();
      if (trimmedTag && !tags.includes(trimmedTag)) {
        setTags([...tags, trimmedTag]);
        setTagInput("");
      }
    }
  };

  const handleTagRemove = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const handleDocumentTypeChange = (value: string) => {
    setDocumentType(value as DocumentType);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!document || isLoading) return;

    // Add any pending tag input to the tags array before submitting
    const finalTags = [...tags];
    const trimmedTagInput = tagInput.trim();
    if (trimmedTagInput && !finalTags.includes(trimmedTagInput)) {
      finalTags.push(trimmedTagInput);
    }
    
    const tagsString = finalTags.join(',');

    const updates = {
      title: title.trim() !== document.title ? title.trim() : undefined,
      document_type: documentType !== document.document_type ? documentType : undefined,
      tags: tagsString !== (document.tags?.join(',') || '') ? tagsString : undefined,
      category: category.trim() !== (document.category || '') ? category.trim() || undefined : undefined,
      version: version.trim() || undefined,
      description: description.trim() !== (document.description || '') ? description.trim() || undefined : undefined
    };

    // Remove undefined values
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined)
    );

    if (Object.keys(cleanUpdates).length > 0) {
      try {
        await onSave(document.document_id, cleanUpdates);
        // Clear pending tag input after successful save
        setTagInput("");
        onClose();
      } catch (error) {
        console.error("Failed to update document:", error);
      }
    } else {
      onClose(); // No changes to save
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isLoading) {
      onClose();
    }
  };

  if (!isOpen || !document) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" onKeyDown={handleKeyDown}>
      <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          onClick={handleClose}
        ></div>

        {/* Modal */}
        <div className="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
          <form onSubmit={handleSubmit}>
            {/* Header */}
            <div className="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium leading-6 text-gray-900">
                  Edit Document Metadata
                </h3>
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isLoading}
                  className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                {/* Title */}
                <div>
                  <label htmlFor="edit-title" className="block text-sm font-medium text-gray-700 mb-1">
                    Title *
                  </label>
                  <input
                    id="edit-title"
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={isLoading}
                    required
                  />
                </div>

                {/* Document Type */}
                <div>
                  <label htmlFor="edit-document-type" className="block text-sm font-medium text-gray-700 mb-1">
                    Document Type *
                  </label>
                  <select
                    id="edit-document-type"
                    value={documentType}
                    onChange={(e) => handleDocumentTypeChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={isLoading}
                    required
                  >
                    {DOCUMENT_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Tags */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tags
                  </label>
                  <div className="flex flex-wrap gap-1 p-2 border border-gray-300 rounded-md min-h-[2.5rem]">
                    {tags.map((tag, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-800"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => handleTagRemove(index)}
                          className="ml-1 text-blue-600 hover:text-blue-800"
                          disabled={isLoading}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={handleTagAdd}
                      className={`flex-1 min-w-0 border-none outline-none text-sm ${
                        tagInput.trim() ? 'bg-yellow-50 text-yellow-800' : ''
                      }`}
                      placeholder={tags.length === 0 ? "Add tags (press Enter or comma)" : "Add more tags..."}
                      disabled={isLoading}
                      title={tagInput.trim() ? `Press Enter to add "${tagInput.trim()}"` : "Type a tag and press Enter"}
                    />
                  </div>
                </div>

                {/* Category */}
                <div>
                  <label htmlFor="edit-category" className="block text-sm font-medium text-gray-700 mb-1">
                    Category
                  </label>
                  <input
                    id="edit-category"
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., Infrastructure, Deployment"
                    disabled={isLoading}
                  />
                </div>

                {/* Version */}
                <div>
                  <label htmlFor="edit-version" className="block text-sm font-medium text-gray-700 mb-1">
                    Version
                  </label>
                  <input
                    id="edit-version"
                    type="text"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="e.g., 1.0, v2.1"
                    disabled={isLoading}
                  />
                </div>

                {/* Description */}
                <div>
                  <label htmlFor="edit-description" className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    id="edit-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    placeholder="Brief description of the document content"
                    disabled={isLoading}
                  />
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
              <button
                type="submit"
                disabled={isLoading || !title.trim()}
                className="inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed sm:ml-3 sm:w-auto"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
              <button
                type="button"
                onClick={handleClose}
                disabled={isLoading}
                className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed sm:mt-0 sm:w-auto"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}