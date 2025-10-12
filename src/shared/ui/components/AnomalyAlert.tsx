import React from 'react';
import type { AnomalyFrame } from '../../../lib/api';

interface AnomalyAlertProps {
  anomaly: AnomalyFrame;
}

/**
 * Anomaly Alert Component
 * Displays detected anomalies with severity indicators
 * Part of OODA Framework v3.2.0 implementation
 */
export const AnomalyAlert: React.FC<AnomalyAlertProps> = ({ anomaly }) => {
  const severityConfig = {
    critical: {
      color: 'red',
      bg: 'bg-red-50',
      border: 'border-red-300',
      text: 'text-red-800',
      icon: '🚨',
      badgeBg: 'bg-red-600',
      badgeText: 'text-white',
      description: 'Immediate attention required',
    },
    high: {
      color: 'orange',
      bg: 'bg-orange-50',
      border: 'border-orange-300',
      text: 'text-orange-800',
      icon: '⚠️',
      badgeBg: 'bg-orange-600',
      badgeText: 'text-white',
      description: 'Significant impact detected',
    },
    medium: {
      color: 'yellow',
      bg: 'bg-yellow-50',
      border: 'border-yellow-300',
      text: 'text-yellow-800',
      icon: '⚡',
      badgeBg: 'bg-yellow-600',
      badgeText: 'text-white',
      description: 'Moderate concern',
    },
    low: {
      color: 'blue',
      bg: 'bg-blue-50',
      border: 'border-blue-300',
      text: 'text-blue-800',
      icon: 'ℹ️',
      badgeBg: 'bg-blue-600',
      badgeText: 'text-white',
      description: 'Minor anomaly detected',
    },
  };

  const severity = anomaly.severity.toLowerCase() as keyof typeof severityConfig;
  const config = severityConfig[severity] || severityConfig.medium;

  return (
    <div
      className={`
        anomaly-alert rounded-lg p-4 mb-4 border-2 shadow-md
        ${config.bg} ${config.border}
      `}
      role="alert"
      aria-live="assertive"
    >
      {/* Header */}
      <div className="alert-header flex items-start gap-3 mb-3">
        {/* Icon */}
        <div className="flex-shrink-0">
          <div
            className={`
              w-10 h-10 rounded-full flex items-center justify-center text-2xl
              ${config.badgeBg}
            `}
          >
            {config.icon}
          </div>
        </div>

        {/* Title and Severity */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`
                inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide
                ${config.badgeBg} ${config.badgeText}
              `}
            >
              {anomaly.severity} Severity
            </span>
            <span className={`text-xs font-medium ${config.text}`}>
              {config.description}
            </span>
          </div>
          <h3 className={`text-sm font-semibold ${config.text}`}>
            Anomaly Detected
          </h3>
        </div>
      </div>

      {/* Anomaly Statement */}
      <div className={`statement mb-3 p-3 rounded-md bg-white border ${config.border}`}>
        <p className="text-sm font-medium text-gray-900">
          {anomaly.statement}
        </p>
      </div>

      {/* Affected Components */}
      <div className="affected-components">
        <div className="flex items-center gap-2 mb-2">
          <svg
            className={`w-4 h-4 ${config.text}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
            />
          </svg>
          <strong className={`text-xs font-semibold ${config.text}`}>
            Affected Components:
          </strong>
        </div>

        <div className="flex flex-wrap gap-2">
          {anomaly.affected_components.map((component: string, index: number) => (
            <span
              key={index}
              className={`
                inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium
                bg-white border ${config.border} ${config.text}
              `}
            >
              <span className="mr-1">🔧</span>
              {component}
            </span>
          ))}
        </div>
      </div>

      {/* Action Prompt */}
      <div className={`mt-3 flex items-start gap-2 p-2 rounded-md bg-white border ${config.border}`}>
        <svg
          className={`w-4 h-4 ${config.text} flex-shrink-0 mt-0.5`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
        <p className={`text-xs ${config.text}`}>
          This anomaly has been flagged for investigation. Additional evidence may be requested to validate the root cause.
        </p>
      </div>
    </div>
  );
};
