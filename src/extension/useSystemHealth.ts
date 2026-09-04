// Centralized system health and error detection
import { useState, useEffect } from 'react';

export interface SystemIssue {
  id: string;
  type: 'api_contract_violation' | 'network_error' | 'auth_error' | 'data_consistency';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  context: Record<string, any>;
  timestamp: string;
  userMessage?: string;
  recommendation?: string;
}

interface UseSystemHealthProps {
  component: string;
  caseId?: string | null;
  sessionCases?: any[];
  isNewUnsavedChat?: boolean;
}

export const useSystemHealth = ({
  component,
  caseId,
  sessionCases = [],
  isNewUnsavedChat = false
}: UseSystemHealthProps) => {
  const [issues, setIssues] = useState<SystemIssue[]>([]);

  // Centralized issue detection - currently disabled to avoid frontend bandaids for backend issues
  useEffect(() => {
    const detectedIssues: SystemIssue[] = [];

    // Note: API Contract Violation detection removed as it was detecting backend issues
    // that frontend cannot fix, causing false positives during normal loading states.
    // Backend should fix API consistency between individual case and collection endpoints.

    setIssues(detectedIssues);

  }, [component, caseId, sessionCases, isNewUnsavedChat]);

  return {
    issues,
    hasIssues: issues.length > 0,
    hasCriticalIssues: issues.some(i => i.severity === 'critical'),
    getIssuesByType: (type: SystemIssue['type']) => issues.filter(i => i.type === type)
  };
};