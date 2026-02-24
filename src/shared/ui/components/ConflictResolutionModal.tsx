/**
 * ConflictResolutionModal - User interface for resolving data conflicts
 *
 * Provides users with choices when automatic conflict resolution fails:
 * - Keep local changes
 * - Accept remote changes
 * - View detailed differences
 * - Restore from backup
 */

import React, { useState } from 'react';
import { ConflictDetectionResult, DataBackup, MergeResult } from '../../../lib/optimistic';

interface ConflictResolutionModalProps {
  isOpen: boolean;
  conflict: ConflictDetectionResult;
  localData: any;
  remoteData: any;
  mergeResult?: MergeResult<any>;
  availableBackups: DataBackup[];
  onResolve: (resolution: ConflictResolution) => void;
  onCancel: () => void;
}

export interface ConflictResolution {
  choice: 'keep_local' | 'accept_remote' | 'use_merged' | 'restore_backup' | 'manual_merge';
  backupId?: string;
  customData?: any;
}

export function ConflictResolutionModal({
  isOpen,
  conflict,
  localData,
  remoteData,
  mergeResult,
  availableBackups,
  onResolve,
  onCancel
}: ConflictResolutionModalProps) {
  const [selectedChoice, setSelectedChoice] = useState<ConflictResolution['choice']>('keep_local');
  const [selectedBackupId, setSelectedBackupId] = useState<string>('');
  const [showDetails, setShowDetails] = useState(false);

  if (!isOpen) return null;

  const handleResolve = () => {
    const resolution: ConflictResolution = {
      choice: selectedChoice,
      backupId: selectedChoice === 'restore_backup' ? selectedBackupId : undefined
    };
    onResolve(resolution);
  };

  const getConflictTitle = () => {
    switch (conflict.conflictType) {
      case 'id_reconciliation':
        return 'Data Synchronization Conflict';
      case 'concurrent_operations':
        return 'Concurrent Changes Detected';
      case 'cross_tab':
        return 'Multiple Tab Conflict';
      case 'data_sync':
        return 'Data Synchronization Issue';
      default:
        return 'Data Conflict';
    }
  };

  const getConflictDescription = () => {
    switch (conflict.conflictType) {
      case 'id_reconciliation':
        return 'Your local changes conflict with data from the server. This can happen when multiple operations are happening simultaneously.';
      case 'concurrent_operations':
        return 'Multiple operations are affecting the same conversation at once. Please choose how to proceed.';
      case 'cross_tab':
        return 'Changes were made in another browser tab or window. Your local changes may conflict with those changes.';
      case 'data_sync':
        return 'Your local data differs significantly from the server data. This may be due to network issues or concurrent edits.';
      default:
        return 'A data conflict has been detected that requires your attention.';
    }
  };

  const formatData = (data: any): string => {
    if (Array.isArray(data)) {
      return `${data.length} messages`;
    }
    if (typeof data === 'string') {
      return data.length > 50 ? `${data.substring(0, 50)}...` : data;
    }
    if (typeof data === 'object') {
      return Object.keys(data).join(', ');
    }
    return String(data);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-fm-surface rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-fm-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">{getConflictTitle()}</h2>
                <p className="text-sm text-fm-dim">Severity: {conflict.severity}</p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="text-fm-muted hover:text-fm-text transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4 overflow-y-auto">
          <p className="text-sm text-fm-text mb-6">{getConflictDescription()}</p>

          {/* Conflict Details */}
          {conflict.conflictingOperations.length > 0 && (
            <div className="mb-6 p-4 bg-fm-bg rounded-lg">
              <h4 className="text-sm font-medium text-white mb-2">Conflicting Operations:</h4>
              <ul className="text-xs text-fm-dim space-y-1">
                {conflict.conflictingOperations.map((opId, index) => (
                  <li key={index}>• Operation: {opId}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Resolution Options */}
          <div className="space-y-4">
            <h3 className="text-base font-medium text-white">Choose Resolution:</h3>

            {/* Keep Local Changes */}
            <label className="flex items-start gap-3 p-4 border rounded-lg cursor-pointer hover:bg-fm-surface">
              <input
                type="radio"
                name="resolution"
                value="keep_local"
                checked={selectedChoice === 'keep_local'}
                onChange={(e) => setSelectedChoice(e.target.value as ConflictResolution['choice'])}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium text-white">Keep Local Changes</div>
                <div className="text-sm text-fm-dim">Use your local data and discard server changes</div>
                <div className="text-xs text-fm-dim mt-1">Local: {formatData(localData)}</div>
              </div>
            </label>

            {/* Accept Remote Changes */}
            <label className="flex items-start gap-3 p-4 border rounded-lg cursor-pointer hover:bg-fm-surface">
              <input
                type="radio"
                name="resolution"
                value="accept_remote"
                checked={selectedChoice === 'accept_remote'}
                onChange={(e) => setSelectedChoice(e.target.value as ConflictResolution['choice'])}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="font-medium text-white">Accept Server Changes</div>
                <div className="text-sm text-fm-dim">Use server data and discard local changes</div>
                <div className="text-xs text-fm-dim mt-1">Remote: {formatData(remoteData)}</div>
              </div>
            </label>

            {/* Use Merged Data (if available) */}
            {mergeResult && (
              <label className="flex items-start gap-3 p-4 border rounded-lg cursor-pointer hover:bg-fm-surface">
                <input
                  type="radio"
                  name="resolution"
                  value="use_merged"
                  checked={selectedChoice === 'use_merged'}
                  onChange={(e) => setSelectedChoice(e.target.value as ConflictResolution['choice'])}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-white">Use Automatic Merge</div>
                  <div className="text-sm text-fm-dim">
                    Use intelligently merged data (Confidence: {mergeResult.confidence})
                  </div>
                  {mergeResult.conflicts.length > 0 && (
                    <div className="text-xs text-yellow-600 mt-1">
                      Conflicts: {mergeResult.conflicts.length}
                    </div>
                  )}
                </div>
              </label>
            )}

            {/* Restore from Backup */}
            {availableBackups.length > 0 && (
              <label className="flex items-start gap-3 p-4 border rounded-lg cursor-pointer hover:bg-fm-surface">
                <input
                  type="radio"
                  name="resolution"
                  value="restore_backup"
                  checked={selectedChoice === 'restore_backup'}
                  onChange={(e) => setSelectedChoice(e.target.value as ConflictResolution['choice'])}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium text-white">Restore from Backup</div>
                  <div className="text-sm text-fm-dim">Choose a previous version to restore</div>
                  {selectedChoice === 'restore_backup' && (
                    <select
                      value={selectedBackupId}
                      onChange={(e) => setSelectedBackupId(e.target.value)}
                      className="mt-2 w-full p-2 border border-fm-border rounded text-sm"
                    >
                      <option value="">Select a backup...</option>
                      {availableBackups.map((backup) => (
                        <option key={backup.id} value={backup.id}>
                          {new Date(backup.timestamp).toLocaleString()} - {backup.dataType}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </label>
            )}
          </div>

          {/* Show Details Toggle */}
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="mt-4 text-sm text-fm-blue hover:text-fm-blue underline"
          >
            {showDetails ? 'Hide Details' : 'Show Detailed Differences'}
          </button>

          {/* Detailed Differences */}
          {showDetails && (
            <div className="mt-4 p-4 bg-fm-bg rounded-lg">
              <h4 className="text-sm font-medium text-white mb-3">Detailed Information:</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div>
                  <h5 className="font-medium text-fm-text mb-1">Local Data:</h5>
                  <pre className="bg-fm-surface p-2 rounded border overflow-auto max-h-32">
                    {JSON.stringify(localData, null, 2)}
                  </pre>
                </div>
                <div>
                  <h5 className="font-medium text-fm-text mb-1">Server Data:</h5>
                  <pre className="bg-fm-surface p-2 rounded border overflow-auto max-h-32">
                    {JSON.stringify(remoteData, null, 2)}
                  </pre>
                </div>
              </div>
              {mergeResult && mergeResult.conflicts.length > 0 && (
                <div className="mt-3">
                  <h5 className="font-medium text-fm-text mb-1">Detected Conflicts:</h5>
                  <ul className="text-fm-dim space-y-1">
                    {mergeResult.conflicts.map((conflict, index) => (
                      <li key={index}>• {conflict}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-fm-border flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-fm-dim hover:text-fm-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleResolve}
            disabled={selectedChoice === 'restore_backup' && !selectedBackupId}
            className="px-4 py-2 bg-fm-blue text-white text-sm rounded hover:bg-fm-active transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Apply Resolution
          </button>
        </div>
      </div>
    </div>
  );
}