/**
 * Case UI Types
 *
 * Re-exports from OpenAPI generated types with convenient type aliases
 * Source: Generated from fm-api-gateway OpenAPI spec
 * To regenerate: npx openapi-typescript http://localhost:8090/openapi.json -o src/types/api.generated.ts
 */

import { components } from './api.generated';

// ==================== Type Aliases from API Contract ====================

// Case lifecycle status: Phases (active) + Dispositions (terminal)
export type CaseStatus = 'inquiry' | 'investigating' | 'resolved' | 'closed';
export type CaseDetail = components['schemas']['CaseDetail'];

/**
 * User-Facing Case Status Types (4 values)
 * Phases: inquiry, investigating (active work)
 * Dispositions: resolved, closed (terminal)
 */
export type UserCaseStatus = CaseStatus;

/**
 * User Case Interface
 * Consolidates definitions from api.ts and optimistic/types.ts
 * Updated 2026-01-30: Added organization_id, closure_reason, closed_at per backend storage fixes
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
  organization_id: string; // Required per multi-tenant storage fixes (commit b434152a)
  closure_reason: string | null; // Required for terminal states (RESOLVED, CLOSED) per commit b434152a
  closed_at: string | null; // Timestamp when case reached terminal state per commit b434152a
  valid_next_states?: string[]; // Server-provided list of allowed case actions (empty for dispositions)
}

// Investigation path enum (added ahead of OpenAPI regen — slice 1 of
// investigation-gates redesign collapsed this to binary; the generated
// types may still list a third value until regenerated, which would
// silently widen the union).
export type InvestigationPath = 'mitigation_first' | 'root_cause';

// PathSelection — the structured Gate-2/Gate-3 state surfaced on every
// CaseUIResponse variant. Added ahead of OpenAPI regen by the backend
// commit that exposes path_selection on the UI response.
export interface PathSelection {
  path: InvestigationPath;
  auto_selected: boolean;
  rationale: string;
  alternate_path?: InvestigationPath | null;

  // Gate 2 (slice 2)
  user_confirmed: boolean;
  user_confirmed_at_turn?: number | null;

  // Gate 3 (slice 3) — meaningful only when path === 'mitigation_first'
  rca_after_mitigation_confirmed: boolean;
  rca_after_mitigation_confirmed_at_turn?: number | null;
  mitigation_completed_at_turn?: number | null;
}

// Inquiry Phase Types
export type CaseUIResponse_Inquiry = components['schemas']['CaseUIResponse_Inquiry'] & {
  /** Path recommendation + Gate-2 state (slice 2). Present once Gate 1 closes. */
  path_selection?: PathSelection | null;
};
export type InquiryData = components['schemas']['InquiryResponseData'];

// Progress Transparency (added ahead of OpenAPI regeneration)
export interface ProgressTransparencyInfo {
  /** Whether transparent mode is active this turn */
  active: boolean;
  /** Milestone that progress is stalled on (e.g., 'root_cause_identified') */
  pending_milestone?: string | null;
  /** Human-readable description of what the pending milestone requires */
  milestone_description?: string | null;
  /** Agent state repair pattern detected, if any */
  repair_type?: string | null;
}

// Investigating Phase Types
export type CaseUIResponse_Investigating = components['schemas']['CaseUIResponse_Investigating'] & {
  /** Progress transparency state. Present when investigation has stalled. */
  progress_transparency?: ProgressTransparencyInfo | null;
  /** Path commitment + Gate-3 state (slices 2 + 3). Always present on INVESTIGATING. */
  path_selection?: PathSelection | null;
  /** Confirmed problem statement (sourced from case.description). */
  problem_statement?: string | null;
};
export type InvestigationProgress = components['schemas']['InvestigationProgressSummary'];
export type ProblemVerification = components['schemas']['ProblemVerificationData'];
export type WorkingConclusion = components['schemas']['WorkingConclusionSummary'];
export type InvestigationStrategy = components['schemas']['InvestigationStrategyData'];

// Resolved Disposition Types
export type CaseUIResponse_Resolved = components['schemas']['CaseUIResponse_Resolved'] & {
  /** Path that was followed; lets terminal UI show mitigation-first retrospectively. */
  path_selection?: PathSelection | null;
  /** Confirmed problem statement (sourced from case.description). */
  problem_statement?: string | null;
};
export type RootCause = components['schemas']['RootCauseSummary'];
export type Solution = components['schemas']['SolutionSummary'];

// Union type for all UI responses (discriminated by status)
export type CaseUIResponse =
  | CaseUIResponse_Inquiry
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

export function isCaseInquiry(
  caseData: CaseUIResponse
): caseData is CaseUIResponse_Inquiry {
  return caseData.status === 'inquiry';
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

export function isCaseClosed(
  caseData: CaseUIResponse | { status: string }
): caseData is CaseUIResponse_Resolved {
  return caseData.status === 'closed';
}
