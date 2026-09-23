/**
 * Case UI Types
 *
 * Re-exports from OpenAPI generated types with convenient type aliases
 * Source: faultmaven's committed docs/reference/api/openapi.json, which CI
 * gates against the running app (fm#880).
 * To regenerate: pnpm generate:api-types
 *
 * Do NOT regenerate from a live server. Generating against whatever build
 * happened to be running is how this repo and the dashboard ended up with
 * different names for the same schema.
 */

import { components } from './api.generated';

// ==================== Type Aliases from API Contract ====================

// Case lifecycle status: Phases (active) + Dispositions (terminal)
export type CaseState = 'inquiry' | 'investigating' | 'resolved' | 'closed';
export type CaseDetail = components['schemas']['CaseDetail'];

// Conversation message row from GET /cases/{id}/messages. Deriving from the
// generated contract keeps the closed role vocabulary a regen-checked fact
// rather than a hand-copy (see the author_id drift note in lib/api/types).
export type Message = components['schemas']['Message'];

/**
 * User-Facing Case Status Types (4 values)
 * Phases: inquiry, investigating (active work)
 * Dispositions: resolved, closed (terminal)
 */
export type UserCaseState = CaseState;

/**
 * User Case Interface
 * Consolidates definitions from api.ts and optimistic/types.ts
 *
 * The tenant a case belongs to is the ENTERPRISE (ADR-017, contract 3.0.0).
 * `enterprise_id` is what the read was scoped by and is always present on a
 * row the server served; `organization_id` is billing attribution, nullable,
 * and answers "who pays", never "who may see this".
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
  /** Isolation tenant. Required — the server never serves a row without it. */
  enterprise_id: string;
  /** Billing attribution only. Null for every account nobody pays for. */
  organization_id?: string | null;
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
//   - ``suggests_alternative``: DO NOT RENDER. Fires only on the
//     close side, for resolution-grade cases: ``Close`` would
//     terminate as RESOLVED instead, discarding the close intent.
//     This used to say the dropdown "hides this verdict and the user
//     sees the *resolved* option directly" — there is no resolved
//     option to see. RESOLVED is not user-selectable; the agent
//     offers it through the confirm/decline pair in chat. So the
//     honest rendering on such a case is NO status control at all.
//   - ``not_eligible``: action is not available — menu item hidden.
//
// Net dropdown rule: of the actions ``ALLOWED_ACTIONS`` permits from
// this state, render those whose verdict is ``ready``. ``resolved``
// is never among them, so ``resolved: 'ready'`` renders nothing — it
// is the engine's own readiness reading, and what it decides is
// whether the AGENT opens the resolution handshake.
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
  /** Drives menu gating. See the note on the INVESTIGATING variant. */
  disposition_eligibility?: DispositionEligibilityMap | null;
};
// `InquiryData` alias removed — same reason the `InvestigationStrategy` alias
// below went: no production consumer anywhere in src/, packages/, e2e/ or
// playground/. It was also the only place in this client that witnessed
// 8.0.0's removal of `decided_to_investigate`, so a reviewer asking what that
// MAJOR costs us was reasoning about blast radius from a type nothing reads.
// Deleting it makes the answer — nil — a fact rather than an inference.

// Progress Transparency. ALIASED, not re-declared: the hand copy was written
// ahead of the OpenAPI regeneration and carried four fields where the schema
// has six, silently dropping `cause_assurance` and `verification_status` —
// the two the contract added so a frontend can label a lower-assurance
// conclusion instead of presenting every conclusion at equal certainty.
// Nothing caught it, because the intersection below narrowed nothing.
export type ProgressTransparencyInfo =
  components['schemas']['ProgressTransparencyInfo'];

// Investigating Phase Types
// ‼ Only the `disposition_eligibility` narrowing survives. The contract
// publishes it as `{ [key: string]: string }` with no enum, so the four-literal
// union is the one member still doing work. `progress_transparency` and
// `problem_statement` re-declared generated members byte-identically — which
// is worse than redundant: an intersection turns a future contract TIGHTENING
// into a no-op instead of a compile error, so making `problem_statement`
// required upstream would re-widen here and the drift gate would stay green.
export type CaseUIResponse_Investigating = components['schemas']['CaseUIResponse_Investigating'] & {
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
  /** All ``not_eligible`` on terminal cases. See the note above. */
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
