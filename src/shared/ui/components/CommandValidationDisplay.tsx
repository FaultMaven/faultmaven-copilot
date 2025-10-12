import React from 'react';
import type { CommandValidation } from '../../../lib/api';

interface CommandValidationDisplayProps {
  validation: CommandValidation;
}

/**
 * Command Validation Display Component
 * Displays command safety validation results
 * Part of OODA Framework v3.2.0 implementation
 */
export const CommandValidationDisplay: React.FC<CommandValidationDisplayProps> = ({ validation }) => {
  const getSafetyConfig = (safetyLevel: string) => {
    switch (safetyLevel) {
      case 'safe':
        return {
          bg: 'bg-green-50',
          border: 'border-green-300',
          text: 'text-green-800',
          badge: 'bg-green-600',
          icon: '✅',
          title: 'Safe to Run'
        };
      case 'read_only':
        return {
          bg: 'bg-blue-50',
          border: 'border-blue-300',
          text: 'text-blue-800',
          badge: 'bg-blue-600',
          icon: '👁',
          title: 'Read-Only Command'
        };
      case 'caution':
        return {
          bg: 'bg-yellow-50',
          border: 'border-yellow-300',
          text: 'text-yellow-800',
          badge: 'bg-yellow-600',
          icon: '⚠️',
          title: 'Use with Caution'
        };
      case 'dangerous':
        return {
          bg: 'bg-red-50',
          border: 'border-red-300',
          text: 'text-red-800',
          badge: 'bg-red-600',
          icon: '🛑',
          title: 'Dangerous Command'
        };
      default:
        return {
          bg: 'bg-gray-50',
          border: 'border-gray-300',
          text: 'text-gray-800',
          badge: 'bg-gray-600',
          icon: '?',
          title: 'Unknown Safety Level'
        };
    }
  };

  const config = getSafetyConfig(validation.safety_level);

  return (
    <div className={`command-validation border-2 rounded-lg p-4 mb-4 shadow-md ${config.bg} ${config.border}`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className={`flex-shrink-0 w-10 h-10 rounded-full ${config.badge} text-white flex items-center justify-center text-2xl`}>
          {config.icon}
        </div>
        <div className="flex-1">
          <h3 className={`text-sm font-bold ${config.text} mb-1`}>
            {config.title}
          </h3>
          <div className="bg-gray-900 text-green-400 rounded px-3 py-2 font-mono text-xs overflow-x-auto">
            <code>{validation.command}</code>
          </div>
        </div>
      </div>

      {/* Overall Safety */}
      <div className="mb-4">
        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${config.badge} text-white`}>
          <span>{validation.is_safe ? 'SAFE TO RUN' : 'NOT RECOMMENDED'}</span>
        </div>
      </div>

      {/* Explanation */}
      <div className="mb-4">
        <h4 className="text-xs font-semibold text-gray-700 mb-2">What this command does:</h4>
        <p className="text-sm text-gray-800 bg-white rounded-md p-3 border border-gray-200">
          {validation.explanation}
        </p>
      </div>

      {/* Concerns */}
      {validation.concerns && validation.concerns.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            Potential Concerns:
          </h4>
          <ul className="space-y-1">
            {validation.concerns.map((concern, index) => (
              <li key={index} className="text-sm text-red-700 flex items-start gap-2 bg-white rounded-md p-2 border border-red-200">
                <span className="flex-shrink-0">⚠️</span>
                <span>{concern}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Safer Alternative */}
      {validation.safer_alternative && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Safer Alternative:
          </h4>
          <div className="bg-green-900 text-green-400 rounded px-3 py-2 font-mono text-xs overflow-x-auto">
            <code>{validation.safer_alternative}</code>
          </div>
        </div>
      )}

      {/* Conditions for Safety */}
      {validation.conditions_for_safety && validation.conditions_for_safety.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-blue-700 mb-2">Safe when:</h4>
          <ul className="space-y-1">
            {validation.conditions_for_safety.map((condition, index) => (
              <li key={index} className="text-sm text-blue-700 flex items-start gap-2 bg-white rounded-md p-2 border border-blue-200">
                <span className="flex-shrink-0">✓</span>
                <span>{condition}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Diagnose First Warning */}
      {validation.should_diagnose_first && (
        <div className="bg-orange-100 border border-orange-300 rounded-md p-3">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-orange-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-orange-900">Recommendation</p>
              <p className="text-xs text-orange-800 mt-1">
                Consider diagnosing the root cause before running this command. Understanding the problem first will help you use this command more effectively.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
