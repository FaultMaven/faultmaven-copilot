import React, { useState } from 'react';
import type { CommandSuggestion } from '../../../lib/api';

interface SuggestedCommandsProps {
  commands: CommandSuggestion[];
  onCommandClick?: (command: string) => void;
}

/**
 * Suggested Commands Component
 * Displays diagnostic commands with safety classification
 * Part of OODA Framework v3.2.0 implementation
 */
export const SuggestedCommands: React.FC<SuggestedCommandsProps> = ({ commands, onCommandClick }) => {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (!commands || commands.length === 0) {
    return null;
  }

  const getSafetyConfig = (safety: string) => {
    switch (safety) {
      case 'safe':
        return {
          color: 'green',
          bg: 'bg-fm-green-light',
          border: 'border-fm-green-border',
          text: 'text-fm-green',
          badge: 'bg-green-600',
          icon: '✓',
          label: 'Safe'
        };
      case 'read_only':
        return {
          color: 'blue',
          bg: 'bg-fm-blue-light',
          border: 'border-fm-blue-border',
          text: 'text-fm-blue',
          badge: 'bg-blue-600',
          icon: '👁',
          label: 'Read-Only'
        };
      case 'caution':
        return {
          color: 'yellow',
          bg: 'bg-fm-yellow-light',
          border: 'border-fm-yellow-border',
          text: 'text-fm-yellow',
          badge: 'bg-yellow-600',
          icon: '⚠️',
          label: 'Caution'
        };
      default:
        return {
          color: 'gray',
          bg: 'bg-fm-bg',
          border: 'border-fm-border',
          text: 'text-fm-text',
          badge: 'bg-gray-600',
          icon: '?',
          label: 'Unknown'
        };
    }
  };

  const handleCommandClick = (command: string) => {
    if (onCommandClick) {
      onCommandClick(command);
    } else {
      // Default: copy to clipboard
      navigator.clipboard.writeText(command);
    }
  };

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  return (
    <div className="suggested-commands bg-fm-surface border border-fm-border rounded-lg p-4 mb-4 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <svg className="w-5 h-5 text-fm-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <h3 className="text-sm font-semibold text-fm-text">Diagnostic Commands</h3>
        <span className="text-xs text-fm-dim">({commands.length})</span>
      </div>

      {/* Commands List */}
      <div className="space-y-2">
        {commands.map((cmd, index) => {
          const config = getSafetyConfig(cmd.safety);
          const isExpanded = expandedIndex === index;

          return (
            <div
              key={index}
              className={`
                command-item border rounded-md transition-all
                ${config.border} ${config.bg}
              `}
            >
              {/* Command Header - Always Visible */}
              <div
                className="flex items-start gap-3 p-3 cursor-pointer hover:bg-opacity-75"
                onClick={() => toggleExpand(index)}
              >
                {/* Safety Badge */}
                <div
                  className={`
                    flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-sm
                    ${config.badge} text-white
                  `}
                  title={config.label}
                >
                  {config.icon}
                </div>

                {/* Command Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${config.badge} text-white`}>
                      {config.label}
                    </span>
                    <p className={`text-xs font-medium ${config.text}`}>
                      {cmd.description}
                    </p>
                  </div>

                  {/* Command */}
                  <div className="bg-gray-900 text-green-400 rounded px-2 py-1 font-mono text-xs overflow-x-auto">
                    <code>{cmd.command}</code>
                  </div>
                </div>

                {/* Expand Icon */}
                <svg
                  className={`w-4 h-4 ${config.text} transition-transform flex-shrink-0 ${
                    isExpanded ? 'transform rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>

              {/* Expanded Details */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2 border-t" style={{ borderColor: config.border.replace('border-', '') }}>
                  {/* Why Section */}
                  <div>
                    <p className="text-xs font-semibold text-fm-text mb-1">Why run this?</p>
                    <p className="text-xs text-fm-dim">{cmd.why}</p>
                  </div>

                  {/* Expected Output */}
                  {cmd.expected_output && (
                    <div>
                      <p className="text-xs font-semibold text-fm-text mb-1">What to look for:</p>
                      <p className="text-xs text-fm-dim italic">{cmd.expected_output}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCommandClick(cmd.command);
                      }}
                      className={`
                        flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors
                        ${config.badge} text-white hover:opacity-90
                      `}
                    >
                      {onCommandClick ? 'Use Command' : 'Copy to Clipboard'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Hint */}
      <div className="mt-3 text-xs text-fm-dim italic">
        Click a command to expand details and safety information
      </div>
    </div>
  );
};
