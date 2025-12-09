/**
 * Case UI Types
 *
 * Re-exports from OpenAPI generated types with convenient type aliases
 * Source: Generated from fm-api-gateway OpenAPI spec
 * To regenerate: npx openapi-typescript http://localhost:8090/openapi.json -o src/types/api.generated.ts
 */

import { components } from './api.generated';

// ==================== Type Aliases from API Contract ====================

// Backend status types
export type CaseStatus = 'consulting' | 'investigating' | 'resolved' | 'closed';

/**
 * User-Facing Case Status Types (4 states)
 * Based on FRONTEND_CASE_STATUS_DROPDOWN_GUIDE.md
 */
export type UserCaseStatus = CaseStatus;

/**
 * User Case Interface
 * Consolidates definitions from api.ts and optimistic/types.ts
 */
export interface UserCase {
  case_id: string;
  title: string;
  status: UserCaseStatus;
  created_at: string;
  updated_at?: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical' | string;
  resolved_at?: string;
  message_count?: number;
  owner_id: string; // Required per v2.0 security
}

// Consulting Phase Types
export type CaseUIResponse_Consulting = components['schemas']['CaseUIResponse_Consulting'];
export type ConsultingData = components['schemas']['ConsultingResponseData'];

// Investigating Phase Types
export type CaseUIResponse_Investigating = components['schemas']['CaseUIResponse_Investigating'];
export type InvestigationProgress = components['schemas']['InvestigationProgressSummary'];
export type ProblemVerification = components['schemas']['ProblemVerificationData'];
export type WorkingConclusion = components['schemas']['WorkingConclusionSummary'];
export type InvestigationStrategy = components['schemas']['InvestigationStrategyData'];

// Resolved Phase Types
export type CaseUIResponse_Resolved = components['schemas']['CaseUIResponse_Resolved'];
export type RootCause = components['schemas']['RootCauseSummary'];
export type Solution = components['schemas']['SolutionSummary'];

// Union type for all UI responses (discriminated by status)
export type CaseUIResponse =
  | CaseUIResponse_Consulting
  | CaseUIResponse_Investigating
  | CaseUIResponse_Resolved;

// Uploaded File Types
export type UploadedFileMetadata = components['schemas']['UploadedFileMetadata'];
export type UploadedFileDetailsResponse = components['schemas']['UploadedFileDetailsResponse'];
export type DerivedEvidenceSummary = components['schemas']['DerivedEvidenceSummary'];

// Evidence Types
export type EvidenceDetailsResponse = components['schemas']['EvidenceDetailsResponse'];
export type SourceFileReference = components['schemas']['SourceFileReference'];
export type RelatedHypothesis = components['schemas']['RelatedHypothesis'];

// ==================== Type Guards ====================

export function isCaseConsulting(
  caseData: CaseUIResponse
): caseData is CaseUIResponse_Consulting {
  return caseData.status === 'consulting';
}

export function isCaseInvestigating(
  caseData: CaseUIResponse
): caseData is CaseUIResponse_Investigating {
  return caseData.status === 'investigating';
}

export function isCaseResolved(
  caseData: CaseUIResponse
): caseData is CaseUIResponse_Resolved {
  return caseData.status === 'resolved';
}
