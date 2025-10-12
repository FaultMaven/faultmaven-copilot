import React, { memo, useState } from 'react';
import { EvidenceRequest, EvidenceCategory, EvidenceStatus } from '../../../lib/api';

interface EvidenceRequestCardProps {
  request: EvidenceRequest;
  className?: string;
}

/**
 * EvidenceRequestCard Component
 *
 * Displays a structured evidence request with category, status, completeness bar,
 * and collapsible guidance sections. No action buttons - user uses existing text box/upload UI.
 *
 * @component
 * @example
 * ```tsx
 * <EvidenceRequestCard request={evidenceRequest} />
 * ```
 */
const EvidenceRequestCard: React.FC<EvidenceRequestCardProps> = memo(({ request, className = '' }) => {
  const [isGuidanceExpanded, setIsGuidanceExpanded] = useState(false);

  // Get category display info
  const categoryInfo = getCategoryInfo(request.category);

  // Get status display info
  const statusInfo = getStatusInfo(request.status);

  // Calculate completeness percentage
  const completenessPercent = Math.round(request.completeness * 100);

  // Check if guidance has any content
  const hasGuidance =
    request.guidance.commands.length > 0 ||
    request.guidance.file_locations.length > 0 ||
    request.guidance.ui_locations.length > 0 ||
    request.guidance.alternatives.length > 0 ||
    request.guidance.prerequisites.length > 0 ||
    request.guidance.expected_output;

  return (
    <div
      className={`border border-gray-200 rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow ${className}`}
      role="article"
      aria-label={`Evidence request: ${request.label}`}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="text-sm font-semibold text-gray-900 flex-1">
            {request.label}
          </h3>

          {/* Category Badge */}
          <span
            className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${categoryInfo.className}`}
            aria-label={`Category: ${categoryInfo.label}`}
          >
            <span className="text-sm" aria-hidden="true">{categoryInfo.icon}</span>
            {categoryInfo.label}
          </span>
        </div>

        {/* Description */}
        <p className="text-sm text-gray-700 mb-3">
          {request.description}
        </p>

        {/* Status and Completeness Row */}
        <div className="flex items-center gap-3 mb-2">
          {/* Status Badge */}
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${statusInfo.className}`}
            aria-label={`Status: ${statusInfo.label}`}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusInfo.dotColor }} aria-hidden="true"></span>
            {statusInfo.label}
          </span>

          {/* Completeness Percentage */}
          <span className="text-xs text-gray-600" aria-label={`${completenessPercent}% complete`}>
            {completenessPercent}% complete
          </span>
        </div>

        {/* Completeness Bar */}
        <div
          className="w-full bg-gray-200 rounded-full h-2 overflow-hidden"
          role="progressbar"
          aria-valuenow={completenessPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Evidence completeness"
        >
          <div
            className={`h-full rounded-full transition-all duration-300 ${getCompletenessBarColor(request.completeness)}`}
            style={{ width: `${completenessPercent}%` }}
          ></div>
        </div>

        {/* Expected Output (if available) */}
        {request.guidance.expected_output && (
          <div className="mt-3 p-2 bg-blue-50 border-l-2 border-blue-400 rounded">
            <p className="text-xs text-blue-800">
              <span className="font-medium">Expected: </span>
              {request.guidance.expected_output}
            </p>
          </div>
        )}
      </div>

      {/* Collapsible Guidance Section */}
      {hasGuidance && (
        <div className="border-t border-gray-200">
          <button
            onClick={() => setIsGuidanceExpanded(!isGuidanceExpanded)}
            className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            aria-expanded={isGuidanceExpanded}
            aria-controls={`guidance-${request.request_id}`}
          >
            <span className="flex items-center gap-2">
              <svg
                className={`w-4 h-4 transition-transform ${isGuidanceExpanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              How to obtain this evidence
            </span>
            <span className="text-xs text-gray-500">
              {isGuidanceExpanded ? 'Hide' : 'Show'} guidance
            </span>
          </button>

          {isGuidanceExpanded && (
            <div
              id={`guidance-${request.request_id}`}
              className="px-4 pb-4 space-y-3"
            >
              {/* Prerequisites */}
              {request.guidance.prerequisites.length > 0 && (
                <GuidanceSection
                  title="Prerequisites"
                  icon="⚙️"
                  items={request.guidance.prerequisites}
                  iconColor="text-orange-600"
                />
              )}

              {/* Commands */}
              {request.guidance.commands.length > 0 && (
                <GuidanceSection
                  title="Commands"
                  icon="💻"
                  items={request.guidance.commands}
                  monospace
                  iconColor="text-green-600"
                />
              )}

              {/* File Locations */}
              {request.guidance.file_locations.length > 0 && (
                <GuidanceSection
                  title="File Locations"
                  icon="📁"
                  items={request.guidance.file_locations}
                  monospace
                  iconColor="text-blue-600"
                />
              )}

              {/* UI Locations */}
              {request.guidance.ui_locations.length > 0 && (
                <GuidanceSection
                  title="UI Locations"
                  icon="🖱️"
                  items={request.guidance.ui_locations}
                  iconColor="text-purple-600"
                />
              )}

              {/* Alternatives */}
              {request.guidance.alternatives.length > 0 && (
                <GuidanceSection
                  title="Alternative Methods"
                  icon="🔄"
                  items={request.guidance.alternatives}
                  iconColor="text-gray-600"
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

EvidenceRequestCard.displayName = 'EvidenceRequestCard';

/**
 * GuidanceSection Component
 * Renders a section of guidance items (commands, files, UI locations, etc.)
 */
interface GuidanceSectionProps {
  title: string;
  icon: string;
  items: string[];
  monospace?: boolean;
  iconColor?: string;
}

const GuidanceSection: React.FC<GuidanceSectionProps> = memo(({
  title,
  icon,
  items,
  monospace = false,
  iconColor = 'text-gray-600'
}) => {
  return (
    <div>
      <h4 className="text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
        <span className={iconColor} aria-hidden="true">{icon}</span>
        {title}
      </h4>
      <ul className="space-y-1" role="list">
        {items.map((item, index) => (
          <li
            key={index}
            className={`text-xs text-gray-800 pl-5 ${monospace ? 'font-mono bg-gray-100 rounded px-2 py-1' : ''}`}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
});

GuidanceSection.displayName = 'GuidanceSection';

/**
 * Helper Functions
 */

function getCategoryInfo(category: EvidenceCategory): { label: string; icon: string; className: string } {
  switch (category) {
    case EvidenceCategory.SYMPTOMS:
      return {
        label: 'Symptoms',
        icon: '🩺',
        className: 'bg-red-100 text-red-800 border border-red-200'
      };
    case EvidenceCategory.TIMELINE:
      return {
        label: 'Timeline',
        icon: '📅',
        className: 'bg-blue-100 text-blue-800 border border-blue-200'
      };
    case EvidenceCategory.CHANGES:
      return {
        label: 'Changes',
        icon: '🔄',
        className: 'bg-purple-100 text-purple-800 border border-purple-200'
      };
    case EvidenceCategory.CONFIGURATION:
      return {
        label: 'Config',
        icon: '⚙️',
        className: 'bg-orange-100 text-orange-800 border border-orange-200'
      };
    case EvidenceCategory.SCOPE:
      return {
        label: 'Scope',
        icon: '🎯',
        className: 'bg-green-100 text-green-800 border border-green-200'
      };
    case EvidenceCategory.METRICS:
      return {
        label: 'Metrics',
        icon: '📊',
        className: 'bg-indigo-100 text-indigo-800 border border-indigo-200'
      };
    case EvidenceCategory.ENVIRONMENT:
      return {
        label: 'Environment',
        icon: '🌍',
        className: 'bg-teal-100 text-teal-800 border border-teal-200'
      };
    default:
      return {
        label: category,
        icon: '📋',
        className: 'bg-gray-100 text-gray-800 border border-gray-200'
      };
  }
}

function getStatusInfo(status: EvidenceStatus): { label: string; className: string; dotColor: string } {
  switch (status) {
    case EvidenceStatus.PENDING:
      return {
        label: 'Pending',
        className: 'bg-gray-100 text-gray-700 border border-gray-200',
        dotColor: '#6b7280'
      };
    case EvidenceStatus.PARTIAL:
      return {
        label: 'Partial',
        className: 'bg-yellow-100 text-yellow-800 border border-yellow-200',
        dotColor: '#f59e0b'
      };
    case EvidenceStatus.COMPLETE:
      return {
        label: 'Complete',
        className: 'bg-green-100 text-green-800 border border-green-200',
        dotColor: '#10b981'
      };
    case EvidenceStatus.BLOCKED:
      return {
        label: 'Blocked',
        className: 'bg-red-100 text-red-800 border border-red-200',
        dotColor: '#ef4444'
      };
    case EvidenceStatus.OBSOLETE:
      return {
        label: 'Obsolete',
        className: 'bg-gray-100 text-gray-500 border border-gray-200',
        dotColor: '#9ca3af'
      };
    default:
      return {
        label: status,
        className: 'bg-gray-100 text-gray-700 border border-gray-200',
        dotColor: '#6b7280'
      };
  }
}

function getCompletenessBarColor(completeness: number): string {
  if (completeness >= 1.0) return 'bg-green-500';
  if (completeness >= 0.7) return 'bg-blue-500';
  if (completeness >= 0.4) return 'bg-yellow-500';
  return 'bg-orange-500';
}

export default EvidenceRequestCard;
