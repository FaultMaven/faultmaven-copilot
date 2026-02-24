import React from 'react';

interface ProblemDetectedAlertProps {
  problemSummary: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Problem Detected Alert Component
 * Displays alert when problem signals are detected (Phase 0)
 * Part of OODA Framework v3.2.0 implementation
 */
export const ProblemDetectedAlert: React.FC<ProblemDetectedAlertProps> = ({ problemSummary, severity }) => {
  const getSeverityConfig = (sev: string) => {
    switch (sev) {
      case 'critical':
        return {
          bg: 'bg-fm-red-light',
          border: 'border-fm-red',
          text: 'text-fm-red',
          badge: 'bg-red-600',
          badgeText: 'text-white',
          icon: '🚨',
          title: 'Critical Issue Detected',
          pulse: true
        };
      case 'high':
        return {
          bg: 'bg-fm-yellow-light',
          border: 'border-fm-yellow',
          text: 'text-fm-yellow',
          badge: 'bg-orange-600',
          badgeText: 'text-white',
          icon: '⚠️',
          title: 'High Priority Issue',
          pulse: true
        };
      case 'medium':
        return {
          bg: 'bg-fm-yellow-light',
          border: 'border-fm-yellow',
          text: 'text-fm-yellow',
          badge: 'bg-yellow-600',
          badgeText: 'text-white',
          icon: '⚡',
          title: 'Issue Detected',
          pulse: false
        };
      case 'low':
        return {
          bg: 'bg-fm-blue-light',
          border: 'border-fm-blue',
          text: 'text-fm-blue',
          badge: 'bg-blue-600',
          badgeText: 'text-white',
          icon: 'ℹ️',
          title: 'Potential Issue',
          pulse: false
        };
      default:
        return {
          bg: 'bg-fm-bg',
          border: 'border-fm-border',
          text: 'text-white',
          badge: 'bg-fm-elevated',
          badgeText: 'text-white',
          icon: '?',
          title: 'Issue Detected',
          pulse: false
        };
    }
  };

  const config = getSeverityConfig(severity);

  return (
    <div className={`problem-detected-alert border-2 rounded-lg p-4 mb-4 shadow-md ${config.bg} ${config.border}`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        {/* Icon with optional pulse animation */}
        <div className={`relative flex-shrink-0 ${config.pulse ? 'animate-pulse' : ''}`}>
          <div className={`w-10 h-10 rounded-full ${config.badge} ${config.badgeText} flex items-center justify-center text-2xl`}>
            {config.icon}
          </div>
          {config.pulse && (
            <span className="absolute top-0 right-0 flex h-3 w-3">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.badge} opacity-75`}></span>
              <span className={`relative inline-flex rounded-full h-3 w-3 ${config.badge}`}></span>
            </span>
          )}
        </div>

        {/* Title and Severity Badge */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className={`text-sm font-bold ${config.text}`}>
              {config.title}
            </h3>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${config.badge} ${config.badgeText}`}>
              {severity}
            </span>
          </div>

          {/* Problem Summary */}
          <div className="bg-fm-surface rounded-md p-3 border-2 border-fm-border">
            <p className="text-sm text-white font-medium">
              {problemSummary}
            </p>
          </div>
        </div>
      </div>

      {/* Next Steps Hint */}
      <div className="flex items-start gap-2 mt-3 p-3 bg-fm-surface bg-opacity-60 rounded-md border border-fm-border">
        <svg className={`w-5 h-5 ${config.text} flex-shrink-0 mt-0.5`} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
        <div>
          <p className={`text-xs font-semibold ${config.text}`}>
            Investigation Started
          </p>
          <p className="text-xs text-fm-text mt-1">
            I'll help you investigate this issue systematically. Let's gather information to understand the scope and find the root cause.
          </p>
        </div>
      </div>

      {/* Add pulse animation keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: .5;
          }
        }
        .animate-pulse {
          animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
      `}</style>
    </div>
  );
};
