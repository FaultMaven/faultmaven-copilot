import React from 'react';

interface EvidenceProgressBarProps {
  collected: number;
  requested: number;
}

/**
 * Evidence Progress Bar Component
 * Tracks evidence collection progress
 * Part of OODA Framework v3.2.0 implementation
 */
export const EvidenceProgressBar: React.FC<EvidenceProgressBarProps> = ({ collected, requested }) => {
  const total = collected + requested;
  const completionPercentage = total > 0 ? Math.round((collected / total) * 100) : 100;
  const isComplete = requested === 0 && collected > 0;

  const getStatusColor = (): string => {
    if (isComplete) return 'from-green-500 to-emerald-500';
    if (completionPercentage >= 75) return 'from-blue-500 to-indigo-500';
    if (completionPercentage >= 50) return 'from-yellow-500 to-orange-500';
    return 'from-orange-500 to-red-500';
  };

  const getStatusText = (): string => {
    if (isComplete) return 'Evidence collection complete';
    if (completionPercentage >= 75) return 'Nearly complete';
    if (completionPercentage >= 50) return 'In progress';
    if (completionPercentage >= 25) return 'Early stage';
    return 'Just started';
  };

  const getStatusIcon = (): string => {
    if (isComplete) return '✅';
    if (completionPercentage >= 75) return '🔍';
    if (completionPercentage >= 50) return '📊';
    return '🔎';
  };

  // Don't render if no evidence activity
  if (collected === 0 && requested === 0) {
    return null;
  }

  return (
    <div className="evidence-progress bg-fm-surface border border-fm-border rounded-lg p-4 mb-4 shadow-sm">
      {/* Header */}
      <div className="progress-header flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{getStatusIcon()}</span>
          <h3 className="text-sm font-semibold text-fm-text">Evidence Collection</h3>
        </div>
        <span className="text-xs text-fm-dim">{getStatusText()}</span>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center bg-fm-green-light border border-fm-green-border rounded-md p-2">
          <div className="text-lg font-bold text-fm-green">{collected}</div>
          <div className="text-xs text-fm-green">Collected</div>
        </div>
        <div className="text-center bg-fm-yellow-light border border-fm-yellow-border rounded-md p-2">
          <div className="text-lg font-bold text-fm-yellow">{requested}</div>
          <div className="text-xs text-fm-yellow">Pending</div>
        </div>
        <div className="text-center bg-fm-blue-light border border-fm-blue-border rounded-md p-2">
          <div className="text-lg font-bold text-fm-blue">{total}</div>
          <div className="text-xs text-fm-blue">Total</div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="progress-bar-container">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-fm-dim">Completion</span>
          <span className="text-xs font-bold text-white">{completionPercentage}%</span>
        </div>

        <div className="relative w-full bg-fm-elevated rounded-full h-3 overflow-hidden">
          {/* Progress Fill */}
          <div
            className={`
              h-full bg-gradient-to-r transition-all duration-500 ease-out
              ${getStatusColor()}
            `}
            style={{ width: `${completionPercentage}%` }}
          >
            {/* Animated Shimmer Effect (only when incomplete) */}
            {!isComplete && (
              <div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-30 animate-shimmer"
                style={{
                  animation: 'shimmer 2s infinite',
                }}
              />
            )}
          </div>

          {/* Completion Checkmark */}
          {isComplete && (
            <div className="absolute right-1 top-1/2 transform -translate-y-1/2">
              <span className="text-white text-xs font-bold">✓</span>
            </div>
          )}
        </div>
      </div>

      {/* Status Message */}
      {requested > 0 && (
        <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md p-2">
          <svg className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-amber-700">
            {requested === 1
              ? 'Awaiting 1 piece of evidence to continue investigation'
              : `Awaiting ${requested} pieces of evidence to continue investigation`}
          </p>
        </div>
      )}

      {isComplete && (
        <div className="mt-3 flex items-start gap-2 bg-fm-green-light border border-fm-green-border rounded-md p-2">
          <svg className="w-4 h-4 text-fm-green flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-xs text-fm-green">
            All requested evidence has been collected. Proceeding with analysis.
          </p>
        </div>
      )}

      {/* Add shimmer animation style */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
};
