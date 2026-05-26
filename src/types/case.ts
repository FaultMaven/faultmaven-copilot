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

// Disposition eligibility — content-readiness gate for terminal actions
// (resolve/close), added ahead of OpenAPI regen by backend PR #373.
//
// Per-verdict semantics (each value drives a distinct UX, see
// HeaderSummary's dropdown render):
//   - ``ready``: action is appropriate; case content supports it.
//   - ``needs_info``: action is allowed but case is partial; the user
//     must add information (root cause / solution) before transitioning.
//   - ``suggests_alternative``: action is allowed but the system
//     recommends the other action for this case (e.g., closing a
//     resolution-grade case would discard attribution). Only fires on
//     the ``closed`` side in the current backend implementation
//     (resolve side never emits this — too-thin cases land on
//     ``not_eligible`` instead since resolve has no path to success
//     without a root cause).
//   - ``not_eligible``: action is not available; the menu item is
//     hidden rather than rendered disabled.
//
// Backend reference: ``derive_disposition_eligibility`` in
// faultmaven/core/investigation/terminal_transitions.py.
export type DispositionEligibility =
  | 'ready'
  | 'needs_info'
  | 'suggests_alternative'
  | 'not_eligible';

export interface DispositionEligibilityMap {
  resolved: DispositionEligibility;
  closed: DispositionEligibility;
}

// Inquiry Phase Types
export type CaseUIResponse_Inquiry = components['schemas']['CaseUIResponse_Inquiry'] & {
  /** Path recommendation + Gate-2 state (slice 2). Present once Gate 1 closes. */
  path_selection?: PathSelection | null;
  /** Per-disposition readiness verdicts (PR #373). Drives menu gating. */
  disposition_eligibility?: DispositionEligibilityMap | null;
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
  /** Per-disposition readiness verdicts (PR #373). Drives menu gating. */
  disposition_eligibility?: DispositionEligibilityMap | null;
};
export type InvestigationProgress = components['schemas']['InvestigationProgressSummary'];
export type ProblemVerification = components['schemas']['ProblemVerificationData'];
export type WorkingConclusion = components['schemas']['WorkingConclusionSummary'];
// `InvestigationStrategy` alias removed — it pointed at
// `InvestigationStrategyData`, the descriptive-string response model that
// fed the old `getApproachHint` regex. Both the regex (slice 4 frontend)
// and the backing field (faultmaven PR #320) are gone; the alias had no
// production consumer. Path information now lives on `PathSelection`,
// already exported above. After the next OpenAPI regen there will be no
// matching `components['schemas']['InvestigationStrategyData']` to point at.

// Resolved Disposition Types
export type CaseUIResponse_Resolved = components['schemas']['CaseUIResponse_Resolved'] & {
  /** Path that was followed; lets terminal UI show mitigation-first retrospectively. */
  path_selection?: PathSelection | null;
  /** Confirmed problem statement (sourced from case.description). */
  problem_statement?: string | null;
  /** Per-disposition readiness verdicts (PR #373). All ``not_eligible`` on terminal cases. */
  disposition_eligibility?: DispositionEligibilityMap | null;
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
