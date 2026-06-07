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
export type CaseState = 'inquiry' | 'investigating' | 'resolved' | 'closed';
export type CaseDetail = components['schemas']['CaseDetail'];

/**
 * User-Facing Case Status Types (4 values)
 * Phases: inquiry, investigating (active work)
 * Dispositions: resolved, closed (terminal)
 */
export type UserCaseState = CaseState;

/**
 * User Case Interface
 * Consolidates definitions from api.ts and optimistic/types.ts
 * Updated 2026-01-30: Added organization_id, closure_reason, closed_at per backend storage fixes
 */
export interface UserCase {
  case_id: string;
  title: string;
  state: UserCaseState;
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


// Disposition eligibility — content-readiness verdicts for the
// terminal actions (resolve/close), added ahead of OpenAPI regen by
// backend PR #373.
//
// Per-verdict semantics:
//   - ``ready``: action is appropriate; case content supports it.
//     This is the *only* verdict the case-action dropdown currently
//     renders as a clickable option — see HeaderSummary's
//     ``getCaseActionOptions``.
//   - ``needs_info``: action is allowed in principle but case is
//     partial. The engine's action-time path (both dropdown and
//     natural-language) asks the user for what's missing rather than
//     proceeding, so the dropdown hides this verdict to keep the
//     menu honest (no dead-end clicks).
//   - ``suggests_alternative``: action is allowed but the engine will
//     pivot to the other disposition at confirmation time. Today
//     this fires only on the close-side for resolution-grade cases:
//     ``Close`` would terminate as RESOLVED instead, discarding the
//     close intent. The dropdown hides this verdict and the user
//     sees the *resolved* option directly (which is the only useful
//     terminal action for the case as-is).
//   - ``not_eligible``: action is not available — menu item hidden.
//
// Net dropdown rule: render only ``ready``. The other verdicts are
// still meaningful as server-side signals (analytics, future use)
// but not user-clickable actions.
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
// production consumer.

// Resolved Disposition Types
export type CaseUIResponse_Resolved = components['schemas']['CaseUIResponse_Resolved'] & {
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
  return caseData.state === 'inquiry';
}

export function isCaseInvestigating(
  caseData: CaseUIResponse
): caseData is CaseUIResponse_Investigating {
  return caseData.state === 'investigating';
}

export function isCaseResolved(
  caseData: CaseUIResponse
): caseData is CaseUIResponse_Resolved {
  return caseData.state === 'resolved';
}

export function isCaseClosed(
  caseData: CaseUIResponse | { state: string }
): caseData is CaseUIResponse_Resolved {
  return caseData.state === 'closed';
}
