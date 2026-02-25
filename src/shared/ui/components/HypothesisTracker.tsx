import React from 'react';
import type { HypothesesSummary } from '../../../lib/api';

interface HypothesisTrackerProps {
  hypotheses: HypothesesSummary;
}

/**
 * Hypothesis Tracker Component
 * Displays active hypotheses and validation status
 * Part of OODA Framework v3.2.0 implementation
 */
export const HypothesisTracker: React.FC<HypothesisTrackerProps> = ({ hypotheses }) => {
  // Don't render if no hypotheses exist
  if (hypotheses.total === 0) {
    return null;
  }

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.8) return 'text-fm-success bg-fm-success-bg';
    if (confidence >= 0.6) return 'text-fm-accent bg-fm-accent-soft';
    if (confidence >= 0.4) return 'text-fm-warning bg-fm-warning-bg';
    return 'text-fm-warning bg-fm-warning-bg';
  };

  const getConfidenceLabel = (confidence: number): string => {
    if (confidence >= 0.8) return 'High Confidence';
    if (confidence >= 0.6) return 'Moderate Confidence';
    if (confidence >= 0.4) return 'Low Confidence';
    return 'Very Low Confidence';
  };

  return (
    <div className="hypothesis-tracker bg-fm-surface border border-fm-border rounded-lg p-4 mb-4 shadow-sm">
      {/* Header */}
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-fm-text-primary mb-1">Investigation Hypotheses</h3>
        <div className="hypothesis-count">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-fm-accent-soft text-fm-accent">
            {hypotheses.total} Active {hypotheses.total === 1 ? 'Theory' : 'Theories'}
          </span>
        </div>
      </div>

      {/* Validated Hypothesis (if exists) */}
      {hypotheses.validated && hypotheses.validated_likelihood !== null && (
        <div className="validated-hypothesis bg-gradient-to-r from-green-50 to-emerald-50 border border-fm-success-border rounded-lg p-4 mb-3">
          <div className="flex items-start gap-3">
            {/* Check Icon */}
            <div className="flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-fm-success-bg0 flex items-center justify-center text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-green-600 text-white">
                  ✅ Validated
                </span>
              </div>

              <div className="statement text-sm font-medium text-white mb-2">
                {hypotheses.validated}
              </div>

              <div className="confidence">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-fm-text-tertiary">Likelihood:</span>
                  <span
                    className={`
                      inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                      ${getConfidenceColor(hypotheses.validated_likelihood)}
                    `}
                  >
                    {(hypotheses.validated_likelihood * 100).toFixed(0)}%
                  </span>
                  <span className="text-xs text-fm-text-tertiary">
                    ({getConfidenceLabel(hypotheses.validated_likelihood)})
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="mt-2 w-full bg-fm-elevated rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-green-500 to-emerald-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(hypotheses.validated_likelihood * 100).toFixed(0)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active Hypotheses (not yet validated) */}
      {!hypotheses.validated && (
        <div className="active-hypotheses bg-fm-accent-soft border border-fm-accent-border rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm text-fm-accent">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span className="font-medium">
              {hypotheses.total === 1
                ? 'Investigating 1 potential root cause'
                : `Investigating ${hypotheses.total} potential root causes`}
            </span>
          </div>
          <p className="text-xs text-fm-accent mt-2 ml-7">
            Evidence collection in progress...
          </p>
        </div>
      )}

      {/* Helper Text */}
      <div className="mt-3 text-xs text-fm-text-tertiary italic">
        Hypotheses are validated through systematic evidence collection and analysis.
      </div>
    </div>
  );
};
