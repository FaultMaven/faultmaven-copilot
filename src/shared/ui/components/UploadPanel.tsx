import React, { useState, useRef, useCallback, useEffect } from "react";
import { DocumentType } from "../../../lib/api";
import AriaLiveRegion from "./AriaLiveRegion";

interface UploadPanelProps {
  onUpload: (data: {
    file: File;
    title: string;
    documentType: DocumentType;
    tags: string;
    category?: string;
    sourceUrl?: string;
    description?: string;
  }) => Promise<void>;
  isUploading?: boolean;
  onCheckDuplicates?: (title: string, documentType: DocumentType) => Promise<any[]>;
}

const DOCUMENT_TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: 'playbook', label: 'Playbook' },
  { value: 'troubleshooting_guide', label: 'Troubleshooting Guide' },
  { value: 'reference', label: 'Reference' },
  { value: 'how_to', label: 'How-To' }
];

export default function UploadPanel({ onUpload, isUploading = false, onCheckDuplicates }: UploadPanelProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState<DocumentType>('playbook');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [category, setCategory] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [description, setDescription] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [ariaMessage, setAriaMessage] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<{
    show: boolean;
    duplicates: any[];
    action: 'upload' | 'edit' | 'cancel' | null;
  }>({ show: false, duplicates: [], action: null });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-infer title from file content or filename
  const inferTitleFromFile = async (selectedFile: File): Promise<string> => {
    try {
      if (selectedFile.type === 'text/markdown' || selectedFile.name.endsWith('.md')) {
        const text = await selectedFile.text();
        const h1Match = text.match(/^#\s+(.+)$/m);
        if (h1Match) {
          return h1Match[1].trim();
        }
      }
      
      // Fall back to filename without extension
      return selectedFile.name.replace(/\.[^/.]+$/, "");
    } catch (error) {
      console.warn("Failed to read file for title inference:", error);
      return selectedFile.name.replace(/\.[^/.]+$/, "");
    }
  };

  const handleFileSelect = useCallback(async (selectedFile: File) => {
    setFile(selectedFile);
    
    // Auto-infer title
    const inferredTitle = await inferTitleFromFile(selectedFile);
    setTitle(inferredTitle);
    
    // Announce file selection
    setAriaMessage(`File selected: ${selectedFile.name}. Title auto-filled as: ${inferredTitle}`);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await handleFileSelect(files[0]); // Single file upload for now
    }
  }, [handleFileSelect]);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

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
    // Check for duplicates when document type changes
    if (title.trim() && onCheckDuplicates) {
      checkForDuplicates(title.trim(), value as DocumentType);
    }
  };

  const checkForDuplicates = async (titleToCheck: string, typeToCheck: DocumentType) => {
    if (!onCheckDuplicates) return;
    
    try {
      const duplicates = await onCheckDuplicates(titleToCheck, typeToCheck);
      if (duplicates.length > 0) {
        setDuplicateWarning({
          show: true,
          duplicates,
          action: null
        });
      } else {
        setDuplicateWarning({ show: false, duplicates: [], action: null });
      }
    } catch (error) {
      console.warn('Failed to check for duplicates:', error);
    }
  };

  // Ref to store the timeout ID for debouncing
  const titleDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Check for duplicates when title changes (debounced)
  const handleTitleChange = (value: string) => {
    setTitle(value);
    
    // Clear any existing duplicate warning if title is empty
    if (!value.trim()) {
      setDuplicateWarning({ show: false, duplicates: [], action: null });
      return;
    }
    
    // Clear existing timeout
    if (titleDebounceRef.current) {
      clearTimeout(titleDebounceRef.current);
    }
    
    // Debounce duplicate checking
    titleDebounceRef.current = setTimeout(() => {
      if (value.trim() && documentType && onCheckDuplicates) {
        checkForDuplicates(value.trim(), documentType);
      }
    }, 500);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (titleDebounceRef.current) {
        clearTimeout(titleDebounceRef.current);
      }
    };
  }, []);

  const isFormValid = file && title.trim() && documentType;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isFormValid || isUploading) return;

    // If there are duplicates and no action has been chosen, show warning
    if (duplicateWarning.show && !duplicateWarning.action) {
      return; // User needs to choose an action first
    }

    // If user chose to cancel, don't proceed
    if (duplicateWarning.action === 'cancel') {
      return;
    }

    const tagsString = tags.join(',');

    try {
      await onUpload({
        file: file!,
        title: title.trim(),
        documentType: documentType,
        tags: tagsString,
        category: category.trim() || undefined,
        sourceUrl: sourceUrl.trim() || undefined,
        description: description.trim() || undefined
      });

      // Reset form
      setFile(null);
      setTitle("");
      setDocumentType('playbook');
      setTags([]);
      setTagInput("");
      setCategory("");
      setSourceUrl("");
      setDescription("");
      setDuplicateWarning({ show: false, duplicates: [], action: null });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      
      // Announce success
      setAriaMessage(`Document "${title}" uploaded successfully.`);
    } catch (error) {
      console.error("Upload failed:", error);
      setAriaMessage(`Upload failed for "${title}". Please try again.`);
    }
  };

  const handleDuplicateAction = (action: 'upload' | 'edit' | 'cancel') => {
    setDuplicateWarning(prev => ({ ...prev, action }));
    
    if (action === 'upload') {
      // User chose to upload anyway, proceed with upload
      const form = document.querySelector('form') as HTMLFormElement;
      form?.requestSubmit();
    } else if (action === 'edit') {
      // User wants to edit existing - this would typically navigate to edit mode
      // For now, we'll just close the warning and let the user handle it
      setDuplicateWarning({ show: false, duplicates: [], action: null });
      setAriaMessage('Please edit the existing document instead of uploading a duplicate.');
    } else if (action === 'cancel') {
      // User cancelled, just hide the warning
      setDuplicateWarning({ show: false, duplicates: [], action: null });
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Upload Document</h3>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* File Picker */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-2">
            File *
          </label>
          <div
            className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
              isDragOver
                ? 'border-blue-400 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {file ? (
              <div className="space-y-2">
                <div className="flex items-center justify-center space-x-2">
                  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-medium text-gray-700">{file.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  Choose different file
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <svg className="mx-auto w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Choose file
                  </button>
                  <span className="text-sm text-gray-500"> or drag and drop</span>
                </div>
                <p className="text-xs text-gray-400">
                  MD, TXT, LOG, JSON, CSV, PDF, DOC, DOCX
                </p>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.txt,.log,.json,.csv,.pdf,.doc,.docx"
            onChange={handleFileInputChange}
            className="hidden"
            disabled={isUploading}
          />
        </div>

        {/* Title */}
        <div>
          <label htmlFor="title" className="block text-xs font-medium text-gray-700 mb-1">
            Title *
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Document title"
            disabled={isUploading}
          />
        </div>

        {/* Document Type */}
        <div>
          <label htmlFor="document-type" className="block text-xs font-medium text-gray-700 mb-1">
            Document Type *
          </label>
          <select
            id="document-type"
            value={documentType}
            onChange={(e) => handleDocumentTypeChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isUploading}
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
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Tags
          </label>
          <div className="space-y-2">
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
                    disabled={isUploading}
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
                className="flex-1 min-w-0 border-none outline-none text-sm"
                placeholder={tags.length === 0 ? "Add tags (press Enter or comma)" : ""}
                disabled={isUploading}
              />
            </div>
          </div>
        </div>

        {/* Optional Fields */}
        <div className="space-y-3 pt-2 border-t border-gray-100">
          <h4 className="text-xs font-medium text-gray-600">Optional Information</h4>
          
          {/* Category */}
          <div>
            <label htmlFor="category" className="block text-xs font-medium text-gray-700 mb-1">
              Category
            </label>
            <input
              id="category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., Infrastructure, Deployment"
              disabled={isUploading}
            />
          </div>

          {/* Source URL */}
          <div>
            <label htmlFor="sourceUrl" className="block text-xs font-medium text-gray-700 mb-1">
              Source URL
            </label>
            <input
              id="sourceUrl"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="https://..."
              disabled={isUploading}
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-xs font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              placeholder="Brief description of the document content"
              disabled={isUploading}
            />
          </div>
        </div>

        {/* Duplicate Warning */}
        {duplicateWarning.show && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-yellow-400 mt-0.5 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="flex-1">
                <h4 className="text-sm font-medium text-yellow-800 mb-2">
                  Possible Duplicate Detected
                </h4>
                <p className="text-sm text-yellow-700 mb-3">
                  Found {duplicateWarning.duplicates.length} existing document(s) with the same title and type:
                </p>
                <ul className="text-sm text-yellow-700 mb-4 space-y-1">
                  {duplicateWarning.duplicates.slice(0, 3).map((doc: any, index: number) => (
                    <li key={index} className="flex items-center">
                      <span className="w-2 h-2 bg-yellow-400 rounded-full mr-2 flex-shrink-0"></span>
                      "{doc.title}" ({doc.document_type})
                      {doc.created_at && (
                        <span className="text-xs text-yellow-600 ml-2">
                          {new Date(doc.created_at).toLocaleDateString()}
                        </span>
                      )}
                    </li>
                  ))}
                  {duplicateWarning.duplicates.length > 3 && (
                    <li className="text-xs text-yellow-600">...and {duplicateWarning.duplicates.length - 3} more</li>
                  )}
                </ul>
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => handleDuplicateAction('upload')}
                    className="flex-1 px-3 py-2 bg-yellow-600 text-white text-sm font-medium rounded hover:bg-yellow-700 transition-colors"
                  >
                    Upload Anyway
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicateAction('edit')}
                    className="flex-1 px-3 py-2 bg-white text-yellow-700 text-sm font-medium rounded border border-yellow-300 hover:bg-yellow-50 transition-colors"
                  >
                    Edit Existing
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicateAction('cancel')}
                    className="flex-1 px-3 py-2 bg-white text-gray-700 text-sm font-medium rounded border border-gray-300 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={!isFormValid || isUploading || (duplicateWarning.show && !duplicateWarning.action)}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Uploading...
              </>
            ) : duplicateWarning.show && duplicateWarning.action === 'upload' ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Upload Anyway
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Upload Document
              </>
            )}
          </button>
        </div>
      </form>
      
      {/* Accessibility: ARIA Live Region for announcements */}
      <AriaLiveRegion message={ariaMessage} priority="polite" />
    </div>
  );
}