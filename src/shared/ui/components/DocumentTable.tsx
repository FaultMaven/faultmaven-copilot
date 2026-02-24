import React from "react";
import { KnowledgeDocument } from "../../../lib/api";
import DocumentRow from "./DocumentRow";

interface DocumentTableProps {
  documents: KnowledgeDocument[];
  onDelete: (id: string) => void;
  loading: boolean;
}

export default function DocumentTable({ documents, onDelete, loading }: DocumentTableProps) {
  // Loading state is now handled in the parent component
  if (loading) {
    return null;
  }

  // Defensive programming: ensure documents is an array
  const documentList = Array.isArray(documents) ? documents : [];

  if (documentList.length === 0) {
    return (
      <div className="bg-fm-surface rounded-lg border border-fm-border p-6 shadow-sm">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 text-fm-muted mb-3">
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
          <h3 className="text-sm font-medium text-white mb-1">No documents yet</h3>
          <p className="text-xs text-fm-dim">
            Upload your first document to get started with the knowledge base.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-fm-surface rounded-lg border border-fm-border shadow-sm">
      {/* Table Header */}
      <div className="px-4 py-3 border-b border-fm-border bg-fm-bg">
        <h3 className="text-sm font-medium text-fm-text">Documents ({documentList.length})</h3>
      </div>

      {/* Table with scroll support - ensure all columns are accessible */}
      <div className="overflow-x-auto overflow-y-auto max-h-96">
        <table className="w-full divide-y divide-fm-border" style={{ minWidth: '800px' }}>
          <thead className="bg-fm-bg sticky top-0 z-10">
            <tr>
              <th className="px-3 py-3 text-left text-xs font-medium text-fm-dim uppercase tracking-wider" style={{ width: '200px', minWidth: '200px' }}>
                Title
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-fm-dim uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                Type
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-fm-dim uppercase tracking-wider" style={{ width: '100px', minWidth: '100px' }}>
                Status
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-fm-dim uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                Tags
              </th>
              <th className="px-2 py-3 text-left text-xs font-medium text-fm-dim uppercase tracking-wider" style={{ width: '140px', minWidth: '140px' }}>
                Date Added
              </th>
              <th className="px-2 py-3 text-right text-xs font-medium text-fm-dim uppercase tracking-wider" style={{ width: '120px', minWidth: '120px' }}>
                Delete
              </th>
            </tr>
          </thead>
          <tbody className="bg-fm-surface divide-y divide-fm-border">
            {documentList.filter(doc => doc && doc.document_id).map((document) => (
              <DocumentRow
                key={document.document_id}
                document={document}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
} 