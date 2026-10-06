import type { components } from '../../../types/api.generated';

// Authentication
export interface AuthState {
  access_token: string;
  token_type: 'bearer';
  /**
   * Access-token expiry, Unix ms — OPTIONAL because a login response need not
   * carry a usable `expires_in`, and the writers deliberately store NO expiry
   * rather than a NaN one. Required typing let `authState.expires_at - now`
   * compile to NaN, which readers then disagreed about. Read it through the
   * host's timestamp guard, never bare.
   */
  expires_at?: number;
  user: {
    user_id: string;
    username: string;
    email: string;
    display_name: string;
    is_dev_user: boolean;
    is_active: boolean;
    roles?: string[];
  };
}

export interface AuthUser {
  user_id: string;
  email: string;
  name: string;
}

/** Who pays for the account, as `/auth/me` names it.
 *
 * BILLING, not isolation (ADR-017 D1/D2): an organization is a cost centre and
 * gates no data. The tenant a session is bound to is its enterprise, which
 * `/auth/me` does not publish at all.
 *
 * Aliased to the generated schema rather than restated. It was hand-written
 * while faultmaven#1068 was in flight and the field did not exist in the spec;
 * now that it does, a rename or reshape there has to break this build instead
 * of silently leaving the organization row empty at runtime. */
export type AccountOrganization = components['schemas']['OrganizationSummary'];

export interface UserProfile {
  user_id: string;
  username: string;
  email: string;
  display_name: string;
  created_at: string;
  is_dev_user: boolean;
  roles?: string[];
  /** Null for every account nobody pays for, and when the row was unreadable.
   *  Never a permission signal — `/auth/me` already succeeded. */
  organization?: AccountOrganization | null;
}

export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  session_id: string;
  user: UserProfile;
}

// Session
export interface Session {
  session_id: string;
  created_at: string;
  status: 'active' | 'idle' | 'expired';
  last_activity?: string;
  metadata?: Record<string, any>;
  user_id: string;
  session_type?: string;
  usage_type?: string;
  client_id?: string;
  session_resumed?: boolean;
  expires_at?: string;
  message?: string;
}

// Common
export interface APIError {
  detail: string;
  error_type?: string;
  correlation_id?: string;
  timestamp?: string;
  context?: Record<string, any>;
}

// Cases & Messages
export type { UserCase, UserCaseState, CaseState } from "../../../types/case";
import { CaseState } from "../../../types/case"; // Import for usage in types

// ============================================================
// Intent-Based Query System (Clean, No Keyword Matching)
// ============================================================

/**
 * Intent types for query routing.
 *
 * Enables reliable intent detection without keyword matching.
 * Each type routes to specialized handling logic in the backend.
 *
 * @example
 * ```typescript
 * const intent: QueryIntent = {
 *   type: IntentType.StatusTransition,
 *   from_state: 'investigating',
 *   to_state: 'closed'
 * };
 * ```
 *
 * ‼ `closed` is the ONLY target this client may send. The example used to
 * build `to_state: 'resolved'`, which is no longer a user-selectable case
 * action — RESOLVED is earned and the agent offers it through the
 * confirm/decline pair, which the client answers with a `confirmation`
 * intent, not a `status_transition`. A copied example is a producer.
 */
export enum IntentType {
  /** Natural language query - use LLM */
  Conversation = 'conversation',
  /** Explicit state transition — `closed` only; see the note above */
  StatusTransition = 'status_transition',
  /** Yes/No confirmation response */
  Confirmation = 'confirmation',
  /** Validate/refute/retire hypothesis */
  HypothesisAction = 'hypothesis_action',
}

/**
 * Structured intent for programmatic query routing.
 * Enables reliable backend handling without keyword matching.
 */
export interface QueryIntent {
  /** Intent type - determines how backend processes the query */
  type: IntentType;

  /** For status_transition: source state */
  from_state?: string;

  /** For status_transition: target state (REQUIRED for status_transition) */
  to_state?: string;

  /** For status_transition: user explicitly confirmed */
  user_confirmed?: boolean;

  /** For hypothesis_action: target hypothesis ID */
  hypothesis_id?: string;

  /** For hypothesis_action: action to perform */
  action?: 'validate' | 'refute' | 'retire';

  /** For confirmation: yes/no value */
  confirmation_value?: boolean;
}

// ============================================================
// Unified Turn System (POST /cases/{id}/turns)
// Replaces /queries and /data endpoints
// ============================================================

/**
 * Request payload for unified turn submission.
 * At least one of query, files, or pastedContent must be provided.
 */
export interface TurnRequest {
  query?: string;
  files?: File[];
  pastedContent?: string;
  intentType?: string;
  intentData?: Record<string, unknown>;
  /** Explicit input origin so the backend can set correct source_metadata without content inspection */
  inputType?: 'file' | 'page_capture' | 'paste';
  /** Source URL for page_capture inputs */
  sourceUrl?: string;
}

/**
 * Result of preprocessing a single attachment.
 */
/**
 * One processed attachment, aliased to the generated schema like `TurnResponse`.
 * Read the input origin through `attachmentOrigin()` (it reads `upload_source`);
 * `source_type` is the preprocessing DATA classification, never the origin.
 */
export type AttachmentResult = components['schemas']['AttachmentResult'];

/**
 * Response from POST /cases/{id}/turns.
 */
/**
 * ‼ ALIASED to the generated schema, not re-declared. The hand-written copy
 * this replaces drifted three ways while compiling clean: it omitted `sources`
 * (so no turn path copied the KB citations and none ever rendered), it made
 * `attachments_processed` required (the contract makes it optional), and its
 * `AttachmentResult` named fields the server never sends (`evidence_id`,
 * `data_type`). `api-types-drift` regenerates and diffs `api.generated.ts`
 * only, so a mirror in this file sits outside the contract gate by
 * construction; aliasing is what puts it back inside.
 */
export type TurnResponse = components['schemas']['TurnResponse'];

export interface Case {
  case_id: string;
  title: string;
  status: CaseState;
  created_at: string;
  updated_at: string;
  description?: string;
  priority?: string;
  resolved_at?: string;
  message_count?: number;
  owner_id: string;
  /** Isolation tenant (ADR-017, contract 3.0.0). Required on every served row. */
  enterprise_id: string;
  /** Billing attribution only; null when nobody pays for the account. */
  organization_id?: string | null;
  closure_reason: string | null; // Required for terminal states per commit b434152a
  closed_at: string | null; // Timestamp when case reached terminal state per commit b434152a
}

export interface CreateCaseRequest {
  title: string | null;  // null = backend auto-generates Case-MMDD-N, string = use provided title
  description?: string;  // Problem description - can be set during creation per commit b434152a
  priority?: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, any>;
  initial_message?: string;
}

export interface CaseUpdateRequest {
  title?: string;
  description?: string;
  status?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  closure_reason?: string; // Required when transitioning to terminal state per commit b434152a
  closed_at?: string; // Auto-set by backend when reaching terminal state per commit b434152a
}

export interface Message {
  message_id: string;
  // The backend CHECK constraint is role IN ('user', 'assistant', 'system');
  // system turns are real (e.g. the runbook-conversion notification).
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  metadata?: Record<string, any>;
  // Who wrote this turn, when a human did. Absent or null otherwise — treat
  // "no author" as the only reliable signal and do NOT infer message kind from
  // it; `role` is what says whether a turn is human-authored. Matches
  // `api.generated.ts`, which has always typed this `string | null`; this
  // hand-written copy claimed non-nullable while the field was in practice
  // always null, so nothing caught the drift.
  author_id?: string | null;
}

export interface User {
  user_id: string;
  username: string;
  email: string;
  display_name: string;
  is_dev_user: boolean;
  is_active: boolean;
  roles?: string[];
}

// Evidence & Analysis
export enum CompletenessLevel {
  PARTIAL = 'partial',
  COMPLETE = 'complete',
  OVER_COMPLETE = 'over_complete'
}

export enum EvidenceForm {
  USER_INPUT = 'user_input',
  DOCUMENT = 'document'
}

export enum EvidenceType {
  SUPPORTIVE = 'supportive',
  REFUTING = 'refuting',
  NEUTRAL = 'neutral',
  ABSENCE = 'absence'
}

export enum UserIntent {
  PROVIDING_EVIDENCE = 'providing_evidence',
  ASKING_QUESTION = 'asking_question',
  REPORTING_UNAVAILABLE = 'reporting_unavailable',
  REPORTING_STATUS = 'reporting_status',
  CLARIFYING = 'clarifying',
  OFF_TOPIC = 'off_topic'
}

/**
 * Where a citation came from, as the contract publishes it.
 *
 * Aliased to the generated schema rather than restated. Contract 3.3.0 made
 * `SourceType` a published component and recorded that this client's own union
 * — `log_analysis | user_input | system_metrics | external_api |
 * previous_case` — shared exactly one member with it. Deriving the union means
 * the next value the server adds arrives here as a compile error rather than
 * as a citation the UI silently labels with its own raw slug.
 */
export type SourceType = components['schemas']['SourceType'];

/**
 * One citation, aliased to the generated schema for the reason `SourceType` is:
 * the hand-written copy had drifted (no `verification_status`, `confidence` and
 * `metadata` never null), and a mirror here sits outside the contract gate.
 */
export type Source = components['schemas']['Source'];

export interface FileMetadata {
  filename: string;
  content_type: string;
  size_bytes: number;
  upload_timestamp: string;
  file_id: string;
}

export interface ConflictDetection {
  contradicted_hypothesis: string;
  reason: string;
  confirmation_required: true;
}

export interface ImmediateAnalysis {
  matched_requests: string[];
  completeness_scores: Record<string, number>;
  key_findings: string[];
  evidence_type: EvidenceType;
  next_steps: string;
}

export type DataType =
  | "logs_and_errors"
  | "unstructured_text"
  | "structured_config"
  | "metrics_and_performance"
  | "source_code"
  | "visual_evidence"
  | "unanalyzable";

export type ProcessingStatus = "pending" | "processing" | "completed" | "failed";

export interface ClassificationMetadata {
  data_type: DataType;
  confidence: number;
  compression_ratio?: number;
  processing_time_ms: number;
}

export interface EvidenceProvided {
  evidence_id: string;
  turn_number: number;
  timestamp: string;
  form: EvidenceForm;
  content: string;
  file_metadata?: FileMetadata | null;
  addresses_requests: string[];
  completeness: CompletenessLevel;
  evidence_type: EvidenceType;
  user_intent: UserIntent;
  key_findings: string[];
  confidence_impact?: number | null;
}

// Suggestion type system — the type IS the agent's intent, and encoding
// follows from it: DECIDE (clickable — click sends payload as the user's
// message), RUN (clickable — click copies payload command to clipboard),
// EVIDENCE / FREE_SPEECH (informational, never clickable).
export type SuggestionType = 'DECIDE' | 'RUN' | 'EVIDENCE' | 'FREE_SPEECH';
/** The clickable subset — these carry a payload. */
export type ClickableSuggestionType = Extract<SuggestionType, 'DECIDE' | 'RUN'>;

export interface SuggestedAction {
  label: string;
  type: SuggestionType;
  /** DECIDE: the exact message a click sends; RUN: the exact command a
   *  click copies. Absent for EVIDENCE/FREE_SPEECH — those carry
   *  everything in label + body/hints and are not clickable. */
  payload?: string;
  body?: string | null;
  hints?: string[];
  icon?: string | null;
  metadata?: Record<string, any>;
  /** Optional intent metadata — when present, frontend sends this as QueryIntent
   *  alongside the payload. Bridges DECIDE suggestions with deterministic
   *  intent routing (e.g., transition confirmations use IntentType.CONFIRMATION). */
  intent?: QueryIntent;
  /** For EVIDENCE-type suggestions: the persistent EvidenceNeed this
   *  suggestion derives from. Format: `eneed_xxxxxxxxxxxx`. Used for
   *  visual linkage (highlight, dismiss, group by need). Backend already
   *  resolves any same-turn `new_index_N` placeholders before this
   *  reaches the wire. */
  evidence_need_id?: string;
}

export interface UploadedData {
  data_id: string;
  case_id: string;
  filename: string;
  file_size: number;
  data_type: 'log_file' | 'error_message' | 'stack_trace' | 'metrics_data' | 'config_file' | 'documentation' | 'unknown';
  processing_status: string;
  uploaded_at: string;

  // Turn response fields (same shape as CaseQueryResponse for endpoint parity)
  agent_response: string;
  turn_number: number;
  milestones_completed: string[];
  case_state: CaseState;
  progress_made: boolean;
  is_stuck: boolean;

  // File metadata
  classification?: ClassificationMetadata;
  schema_version?: string;
}


// Reports — must match backend ReportType enum (owned_models/report.py)
export type ReportType = "resolution_summary" | "closure_summary" | "runbook";
export type ReportStatus = "generating" | "completed" | "failed";
export type RunbookSource = "incident_driven" | "document_driven";

export interface RunbookMetadata {
  source: RunbookSource;
  case_context?: Record<string, any>;
  document_title?: string;
  original_document_id?: string;
  domain: string;
  tags: string[];
  llm_model?: string;
  embedding_model?: string;
}

export interface CaseReport {
  report_id: string;
  case_id: string;
  report_type: ReportType;
  title: string;
  content: string;
  format: "markdown";
  generation_status: ReportStatus;
  generated_at: string;
  generation_time_ms: number;
  is_current: boolean;
  version: number;
  linked_to_closure: boolean;
  metadata?: RunbookMetadata;
}

export interface SimilarRunbook {
  runbook: CaseReport;
  similarity_score: number;
  case_title: string;
  case_id: string;
}

export interface ReportGenerationRequest {
  report_types: ReportType[];
}

export interface ReportGenerationResponse {
  case_id: string;
  reports: CaseReport[];
  remaining_regenerations: number;
}

export interface CaseClosureRequest {
  closure_note?: string;
}

export interface CaseClosureResponse {
  case_id: string;
  closed_at: string;
  archived_reports: CaseReport[];
  download_available_until: string;
}

export interface ViewState {
  session_id: string;
  user: User;
  active_case?: Case | null;
  cases: Case[];
  messages: Message[];
  uploaded_data: UploadedData[];
  show_case_selector: boolean;
  show_data_upload: boolean;
  loading_state?: string | null;
  memory_context?: Record<string, any> | null;
  planning_state?: Record<string, any> | null;
}

export interface TitleGenerateRequest {
  session_id: string;
  context?: {
    last_user_message?: string;
    summary?: string;
    messages?: string;
    notes?: string;
  };
  max_words?: number;
}

export interface TitleResponse {
  schema_version: string;
  title: string;
  view_state?: ViewState;
}

export type DocumentType = 'playbook' | 'troubleshooting_guide' | 'reference' | 'how_to';

export interface KnowledgeDocument {
  document_id: string;
  title: string;
  content?: string;
  document_type: DocumentType;
  category?: string;
  tags: string[];
  source_url?: string;
  description?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, any>;
}

export interface DocumentListResponse {
  documents: KnowledgeDocument[];
  total_count: number;
  limit: number;
  offset: number;
  filters: { document_type?: string; tags?: string[] };
}
