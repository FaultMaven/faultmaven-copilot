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
    if (confidence >= 0.8) return 'text-green-600 bg-green-50';
    if (confidence >= 0.6) return 'text-blue-600 bg-blue-50';
    if (confidence >= 0.4) return 'text-yellow-600 bg-yellow-50';
    return 'text-orange-600 bg-orange-50';
  };

  const getConfidenceLabel = (confidence: number): string => {
    if (confidence >= 0.8) return 'High Confidence';
    if (confidence >= 0.6) return 'Moderate Confidence';
    if (confidence >= 0.4) return 'Low Confidence';
    return 'Very Low Confidence';
  };

  return (
    <div className="hypothesis-tracker bg-white border border-gray-200 rounded-lg p-4 mb-4 shadow-sm">
      {/* Header */}
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Investigation Hypotheses</h3>
        <div className="hypothesis-count">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            {hypotheses.total} Active {hypotheses.total === 1 ? 'Theory' : 'Theories'}
          </span>
        </div>
      </div>

      {/* Validated Hypothesis (if exists) */}
      {hypotheses.validated && hypotheses.validated_confidence !== null && (
        <div className="validated-hypothesis bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4 mb-3">
          <div className="flex items-start gap-3">
            {/* Check Icon */}
            <div className="flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white">
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

              <div className="statement text-sm font-medium text-gray-900 mb-2">
                {hypotheses.validated}
              </div>

              <div className="confidence">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600">Confidence:</span>
                  <span
                    className={`
                      inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                      ${getConfidenceColor(hypotheses.validated_confidence)}
                    `}
                  >
                    {(hypotheses.validated_confidence * 100).toFixed(0)}%
                  </span>
                  <span className="text-xs text-gray-500">
                    ({getConfidenceLabel(hypotheses.validated_confidence)})
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-green-500 to-emerald-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(hypotheses.validated_confidence * 100).toFixed(0)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Active Hypotheses (not yet validated) */}
      {!hypotheses.validated && (
        <div className="active-hypotheses bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span className="font-medium">
              {hypotheses.total === 1
                ? 'Investigating 1 potential root cause'
                : `Investigating ${hypotheses.total} potential root causes`}
            </span>
          </div>
          <p className="text-xs text-blue-600 mt-2 ml-7">
            Evidence collection in progress...
          </p>
        </div>
      )}

      {/* Helper Text */}
      <div className="mt-3 text-xs text-gray-500 italic">
        Hypotheses are validated through systematic evidence collection and analysis.
      </div>
    </div>
  );
};
