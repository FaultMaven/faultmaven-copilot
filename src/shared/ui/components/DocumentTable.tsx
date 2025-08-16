import React from "react";
import { KbDocument } from "../../../lib/api";
import DocumentRow from "./DocumentRow";

interface DocumentTableProps {
  documents: KbDocument[];
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
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="text-center">
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
          <h3 className="text-sm font-medium text-gray-900 mb-1">No documents yet</h3>
          <p className="text-xs text-gray-500">
            Upload your first document to get started with the knowledge base.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {/* Table Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-medium text-gray-700">Documents ({documentList.length})</h3>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Title
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Tags
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Date Added
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
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