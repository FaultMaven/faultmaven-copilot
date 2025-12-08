import React from 'react';
import type { InvestigationProgress } from '../../../lib/api';

interface InvestigationProgressIndicatorProps {
  progress: InvestigationProgress;
}

/**
 * Investigation Progress Indicator Component
 * Displays 7-phase stepper with OODA iteration tracking
 * Part of OODA Framework v3.2.0 implementation
 */
export const InvestigationProgressIndicator: React.FC<InvestigationProgressIndicatorProps> = ({ progress }) => {
  const phases = [
    { id: 0, name: 'Intake', icon: '📝', description: 'Initial problem assessment' },
    { id: 1, name: 'Blast Radius', icon: '💥', description: 'Impact scope analysis' },
    { id: 2, name: 'Timeline', icon: '📅', description: 'Event chronology' },
    { id: 3, name: 'Hypothesis', icon: '💡', description: 'Root cause theories' },
    { id: 4, name: 'Validation', icon: '🔬', description: 'Evidence testing' },
    { id: 5, name: 'Solution', icon: '✅', description: 'Resolution planning' },
    { id: 6, name: 'Document', icon: '📄', description: 'Knowledge capture' },
  ];

  const getPhaseStatus = (phaseId: number): 'completed' | 'active' | 'pending' => {
    const currentPhase = progress.phase.number;
    if (phaseId < currentPhase) return 'completed';
    if (phaseId === currentPhase) return 'active';
    return 'pending';
  };

  const getEngagementModeLabel = (): string => {
    return progress.engagement_mode === 'lead_investigator'
      ? '🎯 Active Investigation'
      : '💬 Consultation';
  };

  const getStatusColor = (): string => {
    switch (progress.case_status) {
      case 'investigating': return 'text-blue-600';
      case 'consulting': return 'text-purple-600';
      case 'resolved': return 'text-green-600';
      case 'closed': return 'text-gray-600';
      default: return 'text-gray-600';
    }
  };

  return (
    <div className="investigation-progress bg-white border border-gray-200 rounded-lg p-4 mb-4 shadow-sm">
      {/* Header */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Investigation Progress</h3>
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span className="font-medium">{getEngagementModeLabel()}</span>
          <span className={`font-medium ${getStatusColor()}`}>
            Status: {progress.case_status.replace('_', ' ').toUpperCase()}
          </span>
        </div>
      </div>

      {/* Phase Stepper */}
      <div className="phase-stepper mb-4">
        <div className="flex justify-between items-start">
          {phases.map((phase, index) => {
            const status = getPhaseStatus(phase.id);
            const isLast = index === phases.length - 1;

            return (
              <div key={phase.id} className="flex-1 relative">
                <div className="flex flex-col items-center">
                  {/* Phase Icon */}
                  <div
                    className={`
                      w-10 h-10 rounded-full flex items-center justify-center text-lg
                      transition-all duration-200 relative z-10
                      ${status === 'completed' ? 'bg-green-500 text-white' : ''}
                      ${status === 'active' ? 'bg-blue-500 text-white ring-4 ring-blue-100' : ''}
                      ${status === 'pending' ? 'bg-gray-200 text-gray-500' : ''}
                    `}
                    title={phase.description}
                  >
                    {phase.icon}
                  </div>

                  {/* Phase Name */}
                  <span
                    className={`
                      mt-2 text-xs font-medium text-center
                      ${status === 'active' ? 'text-blue-600 font-semibold' : ''}
                      ${status === 'completed' ? 'text-green-600' : ''}
                      ${status === 'pending' ? 'text-gray-500' : ''}
                    `}
                  >
                    {phase.name}
                  </span>
                </div>

                {/* Connector Line */}
                {!isLast && (
                  <div
                    className={`
                      absolute top-5 left-1/2 w-full h-0.5 -z-0
                      ${status === 'completed' ? 'bg-green-500' : 'bg-gray-300'}
                    `}
                    style={{ transform: 'translateY(-50%)' }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* OODA Iteration & Turn Count */}
      <div className="ooda-iteration bg-gray-50 rounded-md p-3 border border-gray-200">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-xs text-gray-500 mb-1">OODA Cycle</div>
            <div className="text-lg font-bold text-blue-600">{progress.ooda_iteration}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Turn Count</div>
            <div className="text-lg font-bold text-gray-700">{progress.turn_count}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Current Phase</div>
            <div className="text-lg font-bold text-gray-700">{progress.phase.number + 1}/7</div>
          </div>
        </div>
      </div>
    </div>
  );
};
