import React, { useState } from "react";
import { Source } from "../../../lib/api";
import { formatSource } from "../../../lib/utils/response-handlers";

interface SourcesDisplayProps {
  sources: Source[];
  onDocumentView?: (documentId: string) => void;
  className?: string;
}

interface SourceCardProps {
  source: Source;
  onDocumentView?: (documentId: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

function SourceCard({ source, onDocumentView, isExpanded, onToggleExpand }: SourceCardProps) {
  const formatted = formatSource(source);
  
  // Extract document ID from knowledge base sources for viewing
  const documentId = source.type === 'knowledge_base' && source.metadata?.document_id 
    ? source.metadata.document_id 
    : null;
  
  // Get document title from metadata if available
  const documentTitle = source.type === 'knowledge_base' && source.metadata?.title 
    ? source.metadata.title 
    : null;

  // Confidence score styling
  const getConfidenceStyle = (confidence?: number) => {
    if (!confidence) return { color: 'text-fm-text-tertiary', bg: 'bg-fm-surface' };
    
    if (confidence >= 0.9) return { color: 'text-fm-success', bg: 'bg-fm-success-bg' };
    if (confidence >= 0.7) return { color: 'text-fm-accent', bg: 'bg-fm-accent-soft' };
    if (confidence >= 0.5) return { color: 'text-amber-700', bg: 'bg-amber-50' };
    return { color: 'text-fm-critical', bg: 'bg-fm-critical-bg' };
  };

  const confidenceStyle = getConfidenceStyle(source.confidence);
  
  // Truncate content for preview (with null safety)
  const safeContent = source.content || 'No content available';
  const contentPreview = safeContent.length > 120 
    ? safeContent.substring(0, 120) + "..."
    : safeContent;

  return (
    <div className="bg-fm-surface rounded-lg border border-fm-border hover:border-fm-border transition-all duration-200 hover:shadow-sm">
      {/* Header - Always visible */}
      <div 
        className="flex items-center justify-between p-3 cursor-pointer"
        onClick={onToggleExpand}
      >
        <div className="flex items-center space-x-3 flex-1 min-w-0">
          {/* Source icon and type */}
          <div className="flex items-center space-x-2">
            <span className="text-lg flex-shrink-0">{formatted.emoji}</span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-white truncate">
                {documentTitle || formatted.label}
              </div>
              {documentTitle && (
                <div className="text-xs text-fm-text-tertiary truncate">{formatted.label}</div>
              )}
            </div>
          </div>
          
          {/* Confidence badge */}
          {source.confidence && typeof source.confidence === 'number' && (
            <div className={`px-2 py-1 rounded-full text-xs font-medium ${confidenceStyle.color} ${confidenceStyle.bg} flex-shrink-0`}>
              {Math.round(source.confidence * 100)}%
            </div>
          )}
        </div>

        {/* Expand/collapse indicator */}
        <div className="ml-2 flex-shrink-0">
          <svg 
            className={`w-4 h-4 text-fm-text-secondary transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-fm-border bg-fm-surface/60">
          <div className="p-3 space-y-3">
            {/* Content preview */}
            <div className="text-sm text-fm-text-primary leading-relaxed">
              <div className="bg-fm-bg rounded-md p-2 border-l-4 border-fm-accent-border">
                {isExpanded ? safeContent : contentPreview}
              </div>
            </div>

            {/* Metadata and actions */}
            <div className="flex items-center justify-between pt-2 border-t border-fm-border">
              <div className="flex items-center space-x-4 text-xs text-fm-text-tertiary">
                <span className="flex items-center space-x-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  <span>{formatted.label}</span>
                </span>
                
                {source.metadata?.category && (
                  <span className="flex items-center space-x-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <span>{source.metadata.category}</span>
                  </span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center space-x-2">
                {documentId && onDocumentView && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDocumentView(documentId);
                    }}
                    className="inline-flex items-center space-x-1 px-2 py-1 text-xs font-medium text-fm-accent bg-fm-accent-soft border border-fm-accent-border rounded-md hover:bg-fm-accent-soft hover:border-fm-accent-border transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span>View</span>
                  </button>
                )}
                
                {source.metadata?.source_url && (
                  <a
                    href={source.metadata.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center space-x-1 px-2 py-1 text-xs font-medium text-fm-text-primary bg-fm-bg border border-fm-border rounded-md hover:bg-fm-surface hover:border-fm-border transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    <span>Source</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SourcesDisplay({ sources, onDocumentView, className = "" }: SourcesDisplayProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set());

  if (!sources || sources.length === 0) {
    return null;
  }

  const toggleSource = (index: number) => {
    const newExpanded = new Set(expandedSources);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedSources(newExpanded);
  };

  const toggleAllSources = () => {
    setIsCollapsed(!isCollapsed);
    if (!isCollapsed) {
      // Collapsing - close all individual sources too
      setExpandedSources(new Set());
    }
  };

  // Group sources by type for better organization
  const sourceGroups = sources.reduce((groups, source, index) => {
    const key = source.type;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push({ source, originalIndex: index });
    return groups;
  }, {} as Record<string, Array<{ source: Source; originalIndex: number }>>);

  // Get highest confidence score for overall display (safe calculation)
  const validConfidences = sources.map(s => s.confidence || 0).filter(c => typeof c === 'number' && !isNaN(c));
  const maxConfidence = validConfidences.length > 0 ? Math.max(...validConfidences) : 0;
  const avgConfidence = validConfidences.length > 0 ? validConfidences.reduce((sum, c) => sum + c, 0) / validConfidences.length : 0;

  return (
    <div className={`mt-3 ${className}`}>
      {/* Header - Always visible */}
      <button
        onClick={toggleAllSources}
        className="w-full flex items-center justify-between p-3 bg-fm-accent-soft rounded-lg border border-fm-accent-border hover:bg-fm-surface transition-all duration-200 hover:shadow-sm group"
      >
        <div className="flex items-center space-x-3">
          {/* Sources indicator */}
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium text-fm-accent">
              {sources.length} source{sources.length !== 1 ? 's' : ''}
            </span>
          </div>
          
          {/* Source type indicators */}
          <div className="flex items-center space-x-1">
            {Object.keys(sourceGroups).slice(0, 3).map((type) => {
              const formatted = formatSource({ type, content: '' } as Source);
              return (
                <span key={type} className="text-sm" title={formatted.label}>
                  {formatted.emoji}
                </span>
              );
            })}
            {Object.keys(sourceGroups).length > 3 && (
              <span className="text-xs text-fm-accent font-medium">
                +{Object.keys(sourceGroups).length - 3}
              </span>
            )}
          </div>

          {/* Confidence indicator */}
          {avgConfidence > 0 && (
            <div className="flex items-center space-x-1 px-2 py-1 bg-fm-surface/60 rounded-full border border-fm-accent-border">
              <div className={`w-2 h-2 rounded-full ${
                maxConfidence >= 0.9 ? 'bg-emerald-500' :
                maxConfidence >= 0.7 ? 'bg-blue-500' :
                maxConfidence >= 0.5 ? 'bg-amber-500' : 'bg-red-500'
              }`}></div>
              <span className="text-xs font-medium text-fm-accent">
                {Math.round(avgConfidence * 100)}% avg
              </span>
            </div>
          )}
        </div>

        {/* Expand/collapse indicator */}
        <div className="flex items-center space-x-2">
          <span className="text-xs text-fm-accent font-medium group-hover:text-blue-800">
            {isCollapsed ? 'Show details' : 'Hide details'}
          </span>
          <svg 
            className={`w-4 h-4 text-fm-accent transform transition-transform duration-200 ${!isCollapsed ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded sources list */}
      {!isCollapsed && (
        <div className="mt-2 space-y-2">
          {sources.map((source, index) => (
            <SourceCard
              key={`source-${index}`}
              source={source}
              onDocumentView={onDocumentView}
              isExpanded={expandedSources.has(index)}
              onToggleExpand={() => toggleSource(index)}
            />
          ))}
          
          {/* Summary footer */}
          <div className="mt-4 pt-3 border-t border-fm-border">
            <div className="flex items-center justify-between text-xs text-fm-text-tertiary">
              <span>
                {sources.length} reference{sources.length !== 1 ? 's' : ''} used in this response
              </span>
              <div className="flex items-center space-x-4">
                <span className="flex items-center space-x-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Verified sources</span>
                </span>
                <span className="flex items-center space-x-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>Confidence scored</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}