import React from 'react';
import type { ScopeAssessment } from '../../../lib/api';

interface ScopeAssessmentDisplayProps {
  assessment: ScopeAssessment;
}

/**
 * Scope Assessment Display Component
 * Displays blast radius assessment (Phase 1)
 * Part of OODA Framework v3.2.0 implementation
 */
export const ScopeAssessmentDisplay: React.FC<ScopeAssessmentDisplayProps> = ({ assessment }) => {
  const getSeverityConfig = (severity: string) => {
    switch (severity) {
      case 'critical':
        return {
          color: 'red',
          bg: 'bg-fm-critical-bg',
          border: 'border-fm-border',
          text: 'text-fm-critical',
          badge: 'bg-red-600',
          icon: '🔴'
        };
      case 'high':
        return {
          color: 'orange',
          bg: 'bg-fm-warning-bg',
          border: 'border-fm-warning-border',
          text: 'text-fm-warning',
          badge: 'bg-orange-600',
          icon: '🟠'
        };
      case 'medium':
        return {
          color: 'yellow',
          bg: 'bg-fm-warning-bg',
          border: 'border-fm-warning-border',
          text: 'text-fm-warning',
          badge: 'bg-yellow-600',
          icon: '🟡'
        };
      case 'low':
        return {
          color: 'green',
          bg: 'bg-fm-success-bg',
          border: 'border-fm-success-border',
          text: 'text-fm-success',
          badge: 'bg-green-600',
          icon: '🟢'
        };
      default:
        return {
          color: 'gray',
          bg: 'bg-fm-bg',
          border: 'border-fm-border',
          text: 'text-fm-text-primary',
          badge: 'bg-fm-elevated',
          icon: '⚪'
        };
    }
  };

  const getAffectedScopeLabel = (scope: string) => {
    switch (scope) {
      case 'all_users':
        return {
          label: 'All Users',
          icon: '🌍',
          description: 'Affecting entire user base'
        };
      case 'user_subset':
        return {
          label: 'User Subset',
          icon: '👥',
          description: 'Affecting a portion of users'
        };
      case 'specific_users':
        return {
          label: 'Specific Users',
          icon: '👤',
          description: 'Isolated to specific users'
        };
      case 'unknown':
        return {
          label: 'Unknown',
          icon: '❓',
          description: 'Scope not yet determined'
        };
      default:
        return {
          label: scope,
          icon: '?',
          description: ''
        };
    }
  };

  const config = getSeverityConfig(assessment.severity);
  const scopeInfo = getAffectedScopeLabel(assessment.affected_scope);

  return (
    <div className={`scope-assessment border-2 rounded-lg p-4 mb-4 shadow-md ${config.bg} ${config.border}`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`flex-shrink-0 w-10 h-10 rounded-full ${config.badge} text-white flex items-center justify-center text-2xl`}>
          💥
        </div>
        <div className="flex-1">
          <h3 className={`text-sm font-bold ${config.text}`}>
            Blast Radius Assessment
          </h3>
          <p className="text-xs text-fm-text-tertiary mt-0.5">
            Phase 1: Understanding the scope of impact
          </p>
        </div>
      </div>

      {/* Severity */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-fm-text-primary">Severity:</span>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${config.badge} text-white`}>
            <span>{config.icon}</span>
            <span>{assessment.severity}</span>
          </span>
        </div>
      </div>

      {/* Affected Scope */}
      <div className="mb-4">
        <h4 className="text-xs font-semibold text-fm-text-primary mb-2">Who is affected:</h4>
        <div className="bg-fm-surface rounded-md p-3 border border-fm-border flex items-center gap-3">
          <span className="text-2xl">{scopeInfo.icon}</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">{scopeInfo.label}</p>
            <p className="text-xs text-fm-text-tertiary">{scopeInfo.description}</p>
          </div>
          {assessment.impact_percentage !== null && assessment.impact_percentage !== undefined && (
            <div className="flex-shrink-0">
              <div className={`text-lg font-bold ${config.text}`}>
                {assessment.impact_percentage}%
              </div>
              <div className="text-xs text-fm-text-tertiary">impact</div>
            </div>
          )}
        </div>
      </div>

      {/* Affected Components */}
      {assessment.affected_components && assessment.affected_components.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-fm-text-primary mb-2">Affected Components:</h4>
          <div className="flex flex-wrap gap-2">
            {assessment.affected_components.map((component, index) => (
              <span
                key={index}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-fm-surface border-2 ${config.border} ${config.text}`}
              >
                <span>🔧</span>
                <span>{component}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Impact Description */}
      {assessment.impact_description && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-fm-text-primary mb-2">Impact Summary:</h4>
          <div className="bg-fm-surface rounded-md p-3 border border-fm-border">
            <p className="text-sm text-fm-text-primary">
              {assessment.impact_description}
            </p>
          </div>
        </div>
      )}

      {/* Progress Indicator */}
      <div className="mt-4 p-3 bg-fm-surface bg-opacity-60 rounded-md border border-fm-border">
        <div className="flex items-start gap-2">
          <svg className="w-5 h-5 text-fm-accent flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-xs font-semibold text-white">Blast Radius Assessed</p>
            <p className="text-xs text-fm-text-tertiary mt-1">
              Next: Establishing timeline and gathering evidence to understand when this started
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
