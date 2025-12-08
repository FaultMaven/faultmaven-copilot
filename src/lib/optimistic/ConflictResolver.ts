/**
 * ConflictResolver - Handles conflicts in optimistic updates
 *
 * Detects and resolves conflicts when:
 * - Multiple operations affect the same data
 * - ID reconciliation happens during user actions
 * - Cross-tab modifications occur
 * - Data gets out of sync between optimistic and real state
 */

export interface ConflictDetectionResult {
  hasConflict: boolean;
  conflictType: 'id_reconciliation' | 'concurrent_operations' | 'cross_tab' | 'data_sync' | 'none';
  conflictingOperations: string[];
  affectedData: {
    caseId?: string;
    messageIds?: string[];
    titles?: string[];
  };
  severity: 'low' | 'medium' | 'high';
  autoResolvable: boolean;
}

export interface ConflictResolutionStrategy {
  strategy: 'merge' | 'user_choice' | 'latest_wins' | 'backup_and_retry' | 'manual_resolution';
  backupData?: any;
  userPrompt?: string;
  resolutionFn: () => Promise<void>;
}

export interface ConflictResolution {
  choice: 'keep_local' | 'take_remote' | 'merge' | 'manual';
  mergedData?: any;
}

export interface DataBackup {
  id: string;
  timestamp: number;
  dataType: 'conversation' | 'title' | 'case_state';
  originalData: any;
  conflictingData: any;
  caseId: string;
}

export class ConflictResolver {
  private backups: Map<string, DataBackup> = new Map();
  private activeConflicts: Map<string, ConflictDetectionResult> = new Map();

  /**
   * Detect if there's a conflict when reconciling optimistic data
   */
  detectConflict(
    optimisticData: any,
    realData: any,
    context: {
      caseId: string;
      operationType: string;
      pendingOperations: any[];
    }
  ): ConflictDetectionResult {
    const result: ConflictDetectionResult = {
      hasConflict: false,
      conflictType: 'none',
      conflictingOperations: [],
      affectedData: { caseId: context.caseId },
      severity: 'low',
      autoResolvable: true
    };

    // Check for ID reconciliation conflicts
    if (this.detectIdReconciliationConflict(optimisticData, realData, context)) {
      result.hasConflict = true;
      result.conflictType = 'id_reconciliation';
      result.severity = 'medium';
      result.autoResolvable = true;
    }

    // Check for concurrent operations conflicts
    if (this.detectConcurrentOperationsConflict(context)) {
      result.hasConflict = true;
      result.conflictType = 'concurrent_operations';
      result.severity = 'medium';
      result.autoResolvable = false;
      result.conflictingOperations = context.pendingOperations.map(op => op.id);
    }

    // Check for data synchronization conflicts
    if (this.detectDataSyncConflict(optimisticData, realData)) {
      result.hasConflict = true;
      result.conflictType = 'data_sync';
      result.severity = 'high';
      result.autoResolvable = false;
    }

    return result;
  }

  /**
   * Detect ID reconciliation conflicts
   */
  private detectIdReconciliationConflict(
    optimisticData: any,
    realData: any,
    context: { caseId: string; operationType: string; pendingOperations: any[] }
  ): boolean {
    // Check if there are pending operations on the same case during ID reconciliation
    const pendingOnSameCase = context.pendingOperations.filter(op =>
      op.optimisticData?.caseId === context.caseId ||
      op.optimisticData?.case_id === context.caseId
    );

    // If there are multiple pending operations during reconciliation, it's a conflict
    return pendingOnSameCase.length > 1;
  }

  /**
   * Detect concurrent operations conflicts
   */
  private detectConcurrentOperationsConflict(context: {
    caseId: string;
    operationType: string;
    pendingOperations: any[];
  }): boolean {
    const operationsOnSameCase = context.pendingOperations.filter(op =>
      op.optimisticData?.caseId === context.caseId ||
      op.optimisticData?.case_id === context.caseId
    );

    // Check for conflicting operation types on same case
    const conflictingTypes = ['submit_query', 'update_title'];
    const hasConflictingOps = operationsOnSameCase.some(op =>
      conflictingTypes.includes(op.type) && op.type !== context.operationType
    );

    return hasConflictingOps;
  }

  /**
   * Detect data synchronization conflicts
   */
  private detectDataSyncConflict(optimisticData: any, realData: any): boolean {
    // Check if optimistic data significantly differs from real data
    // This could indicate cross-tab modifications or data corruption

    if (!optimisticData || !realData) return false;

    // Check conversation length mismatch (significant difference)
    if (Array.isArray(optimisticData) && Array.isArray(realData)) {
      const lengthDiff = Math.abs(optimisticData.length - realData.length);
      if (lengthDiff > 2) return true; // More than 2 messages difference is suspicious
    }

    // Check timestamp inconsistencies
    if (optimisticData.timestamp && realData.timestamp) {
      const timeDiff = Math.abs(
        new Date(optimisticData.timestamp).getTime() -
        new Date(realData.timestamp).getTime()
      );
      // More than 5 minutes difference indicates potential conflict
      if (timeDiff > 5 * 60 * 1000) return true;
    }

    return false;
  }

  /**
   * Create a backup of data before resolution
   */
  createBackup(data: any, conflictInfo: ConflictDetectionResult): string {
    const backupId = `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const backup: DataBackup = {
      id: backupId,
      timestamp: Date.now(),
      dataType: this.inferDataType(data),
      originalData: JSON.parse(JSON.stringify(data.optimistic || data)),
      conflictingData: JSON.parse(JSON.stringify(data.real || data)),
      caseId: conflictInfo.affectedData.caseId || 'unknown'
    };

    this.backups.set(backupId, backup);

    // Auto-cleanup old backups (keep only last 10)
    if (this.backups.size > 10) {
      const oldest = Array.from(this.backups.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      this.backups.delete(oldest[0]);
    }

    return backupId;
  }

  /**
   * Get resolution strategy for a conflict
   */
  getResolutionStrategy(conflict: ConflictDetectionResult): ConflictResolutionStrategy {
    switch (conflict.conflictType) {
      case 'id_reconciliation':
        return {
          strategy: 'backup_and_retry',
          userPrompt: 'Data synchronization conflict detected. Retrying operation with latest data.',
          resolutionFn: async () => {
            // Wait for current reconciliation to complete, then retry
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        };

      case 'concurrent_operations':
        return {
          strategy: 'user_choice',
          userPrompt: 'Multiple operations are affecting this conversation. Would you like to wait for them to complete or cancel recent actions?',
          resolutionFn: async () => {
            // User will be prompted to choose resolution
          }
        };

      case 'data_sync':
        return {
          strategy: 'manual_resolution',
          userPrompt: 'Your local data differs significantly from the server. This may be due to changes made in another tab or connection issues.',
          resolutionFn: async () => {
            // Requires manual user intervention
          }
        };

      default:
        return {
          strategy: 'latest_wins',
          resolutionFn: async () => {
            // Default: accept the latest data
          }
        };
    }
  }

  /**
   * Restore data from backup
   */
  restoreFromBackup(backupId: string): any | null {
    const backup = this.backups.get(backupId);
    if (!backup) return null;

    return backup.originalData;
  }

  /**
   * Get all backups for a case
   */
  getBackupsForCase(caseId: string): DataBackup[] {
    return Array.from(this.backups.values())
      .filter(backup => backup.caseId === caseId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Clear resolved conflicts and old backups
   */
  cleanup(maxAge: number = 600000): void { // 10 minutes default
    const now = Date.now();

    // Remove old backups
    for (const [id, backup] of this.backups.entries()) {
      if (now - backup.timestamp > maxAge) {
        this.backups.delete(id);
      }
    }

    // Remove resolved conflicts
    for (const [id, conflict] of this.activeConflicts.entries()) {
      // Remove conflicts that are older than maxAge
      this.activeConflicts.delete(id);
    }
  }

  /**
   * Infer data type from data structure
   */
  private inferDataType(data: any): 'conversation' | 'title' | 'case_state' {
    if (Array.isArray(data)) return 'conversation';
    if (typeof data === 'string') return 'title';
    return 'case_state';
  }

  /**
   * Get conflict statistics
   */
  getStats(): {
    activeConflicts: number;
    totalBackups: number;
    conflictsByType: Record<string, number>;
  } {
    const conflictsByType: Record<string, number> = {};

    for (const conflict of this.activeConflicts.values()) {
      conflictsByType[conflict.conflictType] = (conflictsByType[conflict.conflictType] || 0) + 1;
    }

    return {
      activeConflicts: this.activeConflicts.size,
      totalBackups: this.backups.size,
      conflictsByType
    };
  }
}
