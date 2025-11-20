import config, { getApiUrl } from "../config";
import { clientSessionManager } from "./session/client-session-manager";

// ===== Authentication and Session Management =====

/**
 * Auth state interface matching the authentication design
 */
export interface AuthState {
  access_token: string;
  token_type: 'bearer';
  expires_at: number; // Unix timestamp
  user: {
    user_id: string;
    username: string;
    email: string;
    display_name: string;
    is_dev_user: boolean;
    is_active: boolean;
    roles?: string[]; // User roles (e.g., ['admin'], ['user'])
  };
}

/**
 * Auth manager for centralized authentication state
 */
class AuthManager {
  async saveAuthState(authState: AuthState): Promise<void> {
    if (typeof browser !== 'undefined' && browser.storage) {
      await browser.storage.local.set({ authState });
    }
  }

  async getAuthState(): Promise<AuthState | null> {
    try {
      if (typeof browser !== 'undefined' && browser.storage) {
        const result = await browser.storage.local.get(['authState']);
        const authState = result.authState;

        if (!authState) return null;

        // Check if token is expired
        if (Date.now() >= authState.expires_at) {
          await this.clearAuthState();
          return null;
        }

        return authState;
      }
    } catch (error) {
      console.warn('[AuthManager] Failed to get auth state:', error);
    }
    return null;
  }

  async clearAuthState(): Promise<void> {
    if (typeof browser !== 'undefined' && browser.storage) {
      await browser.storage.local.remove(['authState']);
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const authState = await this.getAuthState();
    return authState !== null;
  }

  /**
   * Get current authenticated user with roles
   * @returns User object or null if not authenticated
   */
  async getCurrentUser(): Promise<User | null> {
    const authState = await this.getAuthState();
    if (!authState) return null;

    return {
      user_id: authState.user.user_id,
      username: authState.user.username,
      email: authState.user.email,
      display_name: authState.user.display_name,
      is_dev_user: authState.user.is_dev_user,
      is_active: authState.user.is_active,
      roles: authState.user.roles || []
    };
  }
}

// Global auth manager instance
export const authManager = new AuthManager();

/**
 * Gets dual headers for API requests (Authentication + Session)
 * Returns both Authorization and X-Session-Id headers when available
 */
async function getAuthHeaders(): Promise<HeadersInit> {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };

  try {
    if (typeof browser !== 'undefined' && browser.storage) {
      // Get auth token from AuthState
      const authState = await authManager.getAuthState();
      if (authState?.access_token) {
        headers['Authorization'] = `Bearer ${authState.access_token}`;
      }

      // Get session ID (keeping existing logic for compatibility)
      const sessionData = await browser.storage.local.get(['sessionId']);
      if (sessionData.sessionId) {
        headers['X-Session-Id'] = sessionData.sessionId;
      }
    }
  } catch (error) {
    // Ignore storage errors - API calls will proceed without auth/session
    console.warn('[API] Failed to get auth/session headers:', error);
  }

  return headers;
}

/**
 * Handles authentication errors and triggers re-authentication
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/**
 * Session expiration error for automatic session refresh
 */
export class SessionExpiredError extends Error {
  constructor(message: string = 'Session expired') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

async function handleAuthError(): Promise<void> {
  // Clear stored auth data
  await authManager.clearAuthState();

  // Trigger re-authentication flow
  // This will be handled by the UI components
  throw new AuthenticationError('Authentication required - please sign in again');
}

/**
 * Handle session expiration by clearing stale session and triggering refresh
 */
async function handleSessionExpired(): Promise<void> {
  // Clear stale session from storage
  if (typeof browser !== 'undefined' && browser.storage) {
    await browser.storage.local.remove(['sessionId', 'sessionCreatedAt', 'sessionResumed']);
  }

  console.warn('[API] Session expired - cleared from storage');
  throw new SessionExpiredError('Session expired - please refresh');
}

/**
 * Enhanced fetch wrapper with auth error handling and error classification
 * Enriches errors with HTTP status codes for proper error classification
 */
/**
 * Wrapper for authenticated fetch with automatic session refresh on expiration
 *
 * Session Expiration Handling (Option C):
 * 1. If backend returns 401 with SESSION_EXPIRED error code
 * 2. Clear stale session_id from storage
 * 3. Call createSession() to get fresh session (uses client_id for resumption)
 * 4. Retry the request once with new session_id
 *
 * This implements the frontend requirement from backend team:
 * - Handle 401 responses with SESSION_EXPIRED code
 * - Automatically refresh session and retry
 * - Maintain client_id for session resumption
 *
 * @param url - API endpoint URL
 * @param options - Fetch options
 * @returns Response from API
 * @throws SessionExpiredError if session refresh fails
 * @throws AuthenticationError if auth is invalid
 */
async function authenticatedFetchWithRetry(url: string, options: RequestInit = {}): Promise<Response> {
  try {
    return await authenticatedFetch(url, options);
  } catch (error) {
    // If session expired, refresh and retry once
    if (error instanceof SessionExpiredError ||
        (error instanceof Error && error.name === 'SessionExpiredError')) {
      console.log('[API] Session expired, attempting refresh and retry...');

      try {
        // Get fresh session (this will call createSession which uses client_id)
        const newSession = await createSession();
        console.log('[API] Fresh session obtained:', newSession.session_id);

        // Retry the request with the same options
        return await authenticatedFetch(url, options);
      } catch (refreshError) {
        console.error('[API] Session refresh failed:', refreshError);
        throw refreshError;
      }
    }

    // Re-throw other errors
    throw error;
  }
}

async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  try {
    const headers = await getAuthHeaders();

    // IMPORTANT: For binary data (FormData, Blob, File, ArrayBuffer), we must NOT set Content-Type
    // The browser will automatically set the correct Content-Type with proper boundaries/encoding
    const isBinaryData = options.body instanceof FormData ||
                        options.body instanceof Blob ||
                        options.body instanceof File ||
                        options.body instanceof ArrayBuffer ||
                        (options.body && (options.body as any) instanceof Uint8Array);

    if (isBinaryData) {
      // Remove Content-Type to let browser handle it automatically
      // - FormData: multipart/form-data with boundary
      // - Blob/File: Uses Blob.type or defaults to application/octet-stream
      // - ArrayBuffer/TypedArray: application/octet-stream
      delete (headers as any)['Content-Type'];
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {})
      }
    });

    // Handle 401 errors - distinguish between auth failure and session expiration
    if (response.status === 401) {
      const errorData = await response.json().catch(() => ({ detail: 'Unauthorized' }));

      // Check if this is a session expiration (backend returns specific error code)
      if (errorData.code === 'SESSION_EXPIRED' ||
          errorData.detail?.toLowerCase().includes('session expired') ||
          errorData.detail?.toLowerCase().includes('session not found')) {
        await handleSessionExpired();
        // handleSessionExpired throws SessionExpiredError
        throw new Error('Session expired'); // Fallback
      }

      // Otherwise it's an authentication failure
      await handleAuthError();
      // handleAuthError throws, but add explicit throw for TypeScript safety
      throw new Error('Authentication required');
    }

    // Enrich non-OK responses with HTTP status for error classification
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
      const error: any = new Error(errorData.detail || `HTTP ${response.status}`);
      error.name = 'HTTPError';
      error.status = response.status;
      error.response = { data: errorData };
      throw error;
    }

    return response;
  } catch (error) {
    // If already thrown from above (HTTP error), re-throw as-is
    if (error instanceof Error && 'status' in error) {
      throw error;
    }

    // Network errors (ECONNREFUSED, timeout, etc.) - wrap with context
    const networkError = error instanceof Error ? error : new Error(String(error));
    networkError.name = 'NetworkError';

    // Add HTTP status if available for better classification
    if ('status' in (error as any)) {
      (networkError as any).status = (error as any).status;
    }

    throw networkError;
  }
}

// ===== Enhanced TypeScript Interfaces for v3.1.0 API =====

export interface Session {
  session_id: string;
  created_at: string;
  status: 'active' | 'idle' | 'expired';
  last_activity?: string;
  metadata?: Record<string, any>;
  // REQUIRED fields per architectural compliance v2.0
  user_id: string;                   // NOW REQUIRED (was optional)
  session_type?: string;
  usage_type?: string;
  // Client-based session management fields
  client_id?: string;                // Device/browser identifier
  session_resumed?: boolean;         // Indicates if session was resumed
  expires_at?: string;               // Session expiration timestamp (TTL)
  message?: string;
}

// New enhanced data structures based on OpenAPI spec

/**
 * Source metadata for data uploads - provides context about where data originated
 */
export interface SourceMetadata {
  source_type: "file_upload" | "text_paste" | "page_capture";
  source_url?: string;  // URL if from page capture
  captured_at?: string;  // ISO 8601 timestamp if from page capture
  user_description?: string;  // User's description of the data
}

export interface UploadedData {
  data_id: string;
  case_id: string;  // Actual case ID (may differ from optimistic ID in request)
  session_id: string;
  data_type: 'log_file' | 'error_message' | 'stack_trace' | 'metrics_data' | 'config_file' | 'documentation' | 'unknown';
  content: string;
  file_name?: string;
  file_size?: number;
  uploaded_at: string;
  processing_status: string;
  insights?: Record<string, any>;
  agent_response?: AgentResponse;  // NEW: AI analysis from backend

  // v3.1.0: Working Memory classification
  classification?: ClassificationMetadata;
  schema_version?: string;
}

// Enhanced query request with new fields
export interface QueryRequest {
  session_id: string;
  query: string;
  priority?: "low" | "normal" | "high" | "critical";
  context?: {
    uploaded_data_ids?: string[];
    page_url?: string;
    browser_info?: string;
    page_content?: string;
    text_data?: string;
    [key: string]: any;
  };
}

// ===== Report Generation Models (FR-CM-006) =====

export type ReportType = "incident_report" | "runbook" | "post_mortem";
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

export interface RunbookRecommendation {
  action: "reuse" | "review_or_generate" | "generate";
  existing_runbook?: CaseReport;
  similarity_score?: number;
  reason: string;
}

export interface ReportRecommendation {
  case_id: string;
  available_for_generation: ReportType[];
  runbook_recommendation: RunbookRecommendation;
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

// ===== Evidence-Centric API v3.1.0 Enums =====

/**
 * Categories of diagnostic evidence
 */
export enum EvidenceCategory {
  SYMPTOMS = 'symptoms',
  TIMELINE = 'timeline',
  CHANGES = 'changes',
  CONFIGURATION = 'configuration',
  SCOPE = 'scope',
  METRICS = 'metrics',
  ENVIRONMENT = 'environment'
}

/**
 * Status of evidence request fulfillment
 */
export enum EvidenceStatus {
  PENDING = 'pending',
  PARTIAL = 'partial',
  COMPLETE = 'complete',
  BLOCKED = 'blocked',
  OBSOLETE = 'obsolete'
}

/**
 * Investigation approach - speed vs depth
 */
export enum InvestigationMode {
  ACTIVE_INCIDENT = 'active_incident',
  POST_MORTEM = 'post_mortem'
}

/**
 * Current case investigation state
 */
export enum CaseStatus {
  INTAKE = 'intake',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  MITIGATED = 'mitigated',
  STALLED = 'stalled',
  ABANDONED = 'abandoned',
  CLOSED = 'closed'
}

/**
 * How well evidence answers specific request(s)
 * over_complete means satisfies >1 request
 */
export enum CompletenessLevel {
  PARTIAL = 'partial',
  COMPLETE = 'complete',
  OVER_COMPLETE = 'over_complete'
}

/**
 * How evidence was submitted
 */
export enum EvidenceForm {
  USER_INPUT = 'user_input',
  DOCUMENT = 'document'
}

/**
 * How evidence relates to current hypotheses
 */
export enum EvidenceType {
  SUPPORTIVE = 'supportive',
  REFUTING = 'refuting',
  NEUTRAL = 'neutral',
  ABSENCE = 'absence'
}

/**
 * User's intent when submitting input
 */
export enum UserIntent {
  PROVIDING_EVIDENCE = 'providing_evidence',
  ASKING_QUESTION = 'asking_question',
  REPORTING_UNAVAILABLE = 'reporting_unavailable',
  REPORTING_STATUS = 'reporting_status',
  CLARIFYING = 'clarifying',
  OFF_TOPIC = 'off_topic'
}

// New response types based on v3.1.0 API
export enum ResponseType {
  ANSWER = "ANSWER",
  PLAN_PROPOSAL = "PLAN_PROPOSAL",
  CLARIFICATION_REQUEST = "CLARIFICATION_REQUEST",
  CONFIRMATION_REQUEST = "CONFIRMATION_REQUEST",
  SOLUTION_READY = "SOLUTION_READY",
  NEEDS_MORE_DATA = "NEEDS_MORE_DATA",
  ESCALATION_REQUIRED = "ESCALATION_REQUIRED"
}

export interface Source {
  type: 'log_analysis' | 'knowledge_base' | 'user_input' | 'system_metrics' | 'external_api' | 'previous_case';
  content: string;
  confidence?: number;
  metadata?: Record<string, any>;
}

export interface PlanStep {
  step_number: number;
  action: string;
  description: string;
  estimated_time?: string;
  dependencies?: number[];
  required_tools?: string[];
}

/**
 * Investigation phase information (OODA Framework v3.2.0)
 */
export interface InvestigationPhase {
  /** Phase name (e.g., "INTAKE", "HYPOTHESIS", "VALIDATION") */
  current: string;
  /** Phase number (0-6) */
  number: number;
}

/**
 * Hypothesis tracking (OODA Framework v3.2.0)
 */
export interface HypothesesSummary {
  /** Total number of active hypotheses */
  total: number;
  /** Validated hypothesis statement (null if none validated) */
  validated: string | null;
  /** Confidence score for validated hypothesis (0.0-1.0) */
  validated_confidence: number | null;
}

/**
 * Anomaly frame information (OODA Framework v3.2.0)
 */
export interface AnomalyFrame {
  /** Anomaly statement */
  statement: string;
  /** Severity level */
  severity: string;
  /** List of affected components */
  affected_components: string[];
}

/**
 * OODA Framework investigation progress (v3.2.0)
 */
export interface InvestigationProgress {
  /** Current investigation phase */
  phase: InvestigationPhase;
  /** Engagement mode: "consultant" or "lead_investigator" */
  engagement_mode: "consultant" | "lead_investigator";
  /** Current OODA iteration within phase */
  ooda_iteration: number;
  /** Total conversation turns */
  turn_count: number;
  /** Case status */
  case_status: CaseStatus;
  /** Hypothesis tracking */
  hypotheses: HypothesesSummary;
  /** Number of evidence items collected */
  evidence_collected: number;
  /** Number of pending evidence requests */
  evidence_requested: number;
  /** Anomaly frame (optional) */
  anomaly_frame?: AnomalyFrame;
}

/**
 * User information from backend
 */
export interface User {
  user_id: string;
  username: string;
  email: string;
  display_name: string;
  is_dev_user: boolean;
  is_active: boolean;
  roles?: string[]; // User roles for access control (e.g., ['admin'], ['user'])
}

/**
 * Case information from backend (v2.0 - Session-Independent)
 */
export interface Case {
  case_id: string;
  title: string;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
  description?: string;
  priority?: string;
  resolved_at?: string;
  message_count?: number;
  owner_id: string;                  // NOW REQUIRED (was optional) - security fix
  // session_id REMOVED - cases are session-independent
}

/**
 * Message information from backend (v2.0 - User Attribution Required)
 */
export interface Message {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  metadata?: Record<string, any>;
  author_id: string;                 // NOW REQUIRED (was optional) - user attribution
  // session_id REMOVED - use author_id instead
}

/**
 * COMPLETE ViewState matching backend schema (v3.2.0)
 */
export interface ViewState {
  /** Session identifier */
  session_id: string;
  /** User context */
  user: User;
  /** Currently active case */
  active_case?: Case | null;
  /** All user's cases */
  cases: Case[];
  /** Messages for active case */
  messages: Message[];
  /** Uploaded data for active case */
  uploaded_data: UploadedData[];
  /** UI hint: show case selector */
  show_case_selector: boolean;
  /** UI hint: show data upload option */
  show_data_upload: boolean;
  /** Optional loading message */
  loading_state?: string | null;
  /** Agent memory context */
  memory_context?: Record<string, any> | null;
  /** Agent planning state */
  planning_state?: Record<string, any> | null;

  // ===== OODA FRAMEWORK (v3.2.0) =====
  /** Investigation progress tracking */
  investigation_progress?: InvestigationProgress | null;

}

// ===== Evidence-Centric API v3.1.0 Interfaces =====

/**
 * Instructions for obtaining diagnostic evidence
 */
export interface AcquisitionGuidance {
  /** Shell commands to run (max 3) */
  commands: string[];
  /** File paths to check (max 3) */
  file_locations: string[];
  /** UI navigation paths (max 3) */
  ui_locations: string[];
  /** Alternative methods to obtain evidence (max 3) */
  alternatives: string[];
  /** Requirements to obtain evidence (max 2) */
  prerequisites: string[];
  /** What the user should expect to see (max 200 chars) */
  expected_output?: string | null;
}

/**
 * Structured request for diagnostic evidence with acquisition guidance
 */
export interface EvidenceRequest {
  /** Unique identifier for this evidence request */
  request_id: string;
  /** Brief title for the request (max 100 chars) */
  label: string;
  /** What evidence is needed and why (max 500 chars) */
  description: string;
  /** Category of evidence */
  category: EvidenceCategory;
  /** How to obtain the evidence */
  guidance: AcquisitionGuidance;
  /** Current status of request */
  status: EvidenceStatus;
  /** Turn number when request was created */
  created_at_turn: number;
  /** Turn number when last updated */
  updated_at_turn?: number | null;
  /** Fulfillment completeness score (0.0 to 1.0) */
  completeness: number;
  /** Additional context */
  metadata: Record<string, any>;
}

/**
 * Metadata for uploaded files (documents, log excerpts)
 */
export interface FileMetadata {
  /** Original filename */
  filename: string;
  /** MIME type (e.g., text/plain, application/json) */
  content_type: string;
  /** File size in bytes */
  size_bytes: number;
  /** When file was uploaded (ISO 8601) */
  upload_timestamp: string;
  /** Storage reference ID */
  file_id: string;
}

/**
 * Detection of refuting evidence
 */
export interface ConflictDetection {
  /** Which hypothesis is contradicted */
  contradicted_hypothesis: string;
  /** Why this is a conflict */
  reason: string;
  /** User must confirm refutation */
  confirmation_required: true;
}

/**
 * Immediate feedback after file upload
 */
export interface ImmediateAnalysis {
  /** Evidence request IDs this data satisfies */
  matched_requests: string[];
  /** Map of request_id to completeness score (0.0 to 1.0) */
  completeness_scores: Record<string, number>;
  /** Top findings from the uploaded data (max 5) */
  key_findings: string[];
  /** How evidence relates to hypotheses */
  evidence_type: EvidenceType;
  /** What the agent will do next */
  next_steps: string;
}

// ===== Working Memory v3.1.0: Data Classification & Source Metadata =====

/**
 * Data type classification (7 types)
 * Matches backend DataType enum
 */
export type DataType =
  | "logs_and_errors"
  | "unstructured_text"
  | "structured_config"
  | "metrics_and_performance"
  | "source_code"
  | "visual_evidence"
  | "unanalyzable";

/**
 * Processing status for uploads
 */
export type ProcessingStatus = "pending" | "processing" | "completed" | "failed";

/**
 * Source metadata - where the data came from
 * NEW: Enables richer AI context
 */
export interface SourceMetadata {
  source_type: "file_upload" | "text_paste" | "page_capture";
  source_url?: string;           // URL if from page capture
  captured_at?: string;          // ISO 8601 timestamp for page capture
  user_description?: string;     // User's description of the data
}

/**
 * Classification metadata returned from backend
 */
export interface ClassificationMetadata {
  data_type: DataType;
  confidence: number;           // 0.0 to 1.0
  compression_ratio?: number;   // How much data was compressed
  processing_time_ms: number;   // Time taken to process
}

/**
 * Record of evidence user provided
 */
export interface EvidenceProvided {
  /** Unique evidence ID */
  evidence_id: string;
  /** Turn number when submitted */
  turn_number: number;
  /** When submitted (ISO 8601) */
  timestamp: string;
  /** How evidence was submitted */
  form: EvidenceForm;
  /** Text or file reference/path */
  content: string;
  /** Populated when form == document */
  file_metadata?: FileMetadata | null;
  /** Evidence request IDs this satisfies */
  addresses_requests: string[];
  /** How well it answers requests */
  completeness: CompletenessLevel;
  /** How it relates to hypotheses */
  evidence_type: EvidenceType;
  /** User's intent */
  user_intent: UserIntent;
  /** Key findings extracted */
  key_findings: string[];
  /** Confidence impact (-1.0 to 1.0) */
  confidence_impact?: number | null;
}

// ===== OODA v3.2.0: Enhanced Action Interfaces =====

/**
 * Suggested action for user guidance (RE-ENABLED in v3.2.0)
 */
export interface SuggestedAction {
  label: string;
  type: 'question_template' | 'command' | 'upload_data' | 'transition' | 'create_runbook';
  payload: string;
  icon?: string | null;
  metadata?: Record<string, any>;
}

/**
 * Diagnostic command suggestion with safety classification (v3.2.0)
 */
export interface CommandSuggestion {
  command: string;
  description: string;
  why: string;
  safety: 'safe' | 'read_only' | 'caution';
  expected_output?: string | null;
}

/**
 * Command validation response (v3.2.0)
 */
export interface CommandValidation {
  command: string;
  is_safe: boolean;
  safety_level: 'safe' | 'read_only' | 'caution' | 'dangerous';
  explanation: string;
  concerns: string[];
  safer_alternative?: string | null;
  conditions_for_safety: string[];
  should_diagnose_first: boolean;
}

/**
 * Root cause hypothesis with testing strategy (v3.2.0)
 */
export interface Hypothesis {
  statement: string;
  likelihood: number; // 0.0 to 1.0
  supporting_evidence: string[];
  category: 'configuration' | 'code' | 'infrastructure' | 'dependency' | 'data';
  testing_strategy: string;
  status: 'pending' | 'testing' | 'validated' | 'refuted';
}

/**
 * Hypothesis validation test result (v3.2.0)
 */
export interface TestResult {
  test_description: string;
  outcome: 'supports' | 'refutes' | 'inconclusive';
  confidence_impact: number; // -1.0 to 1.0
  evidence_summary: string;
}

/**
 * Blast radius assessment (Phase 1) (v3.2.0)
 */
export interface ScopeAssessment {
  affected_scope: 'all_users' | 'user_subset' | 'specific_users' | 'unknown';
  affected_components: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  impact_percentage?: number | null;
  impact_description?: string | null;
}

// Enhanced AgentResponse based on v3.2.0 API (OODA Response Formats)
export interface AgentResponse {
  // ===== CORE FIELDS (Always Present) =====
  /** Schema version */
  schema_version?: string;
  /** Agent's conversational response */
  content: string;
  /** Response classification */
  response_type: ResponseType;
  /** Session identifier */
  session_id: string;
  /** Case identifier */
  case_id?: string | null;
  /** Confidence in response (0.0 to 1.0) */
  confidence_score?: number | null;
  /** Source references */
  sources?: Source[];
  /** Plan step information */
  plan?: PlanStep | null;
  /** Estimated resolution time */
  estimated_time_to_resolution?: string;
  /** Hint for next user action */
  next_action_hint?: string | null;
  /** UI state hints */
  view_state?: ViewState | null;
  /** Additional metadata */
  metadata?: Record<string, any>;

  // ===== v3.1.0 FIELDS (Evidence-Centric) =====
  /** Active evidence requests for this turn */
  evidence_requests: EvidenceRequest[];
  /** Current investigation approach (speed vs depth) */
  investigation_mode: InvestigationMode;
  /** Current case investigation state */
  case_status: CaseStatus;

  // ===== v3.2.0 NEW FIELDS (OODA Response Formats) =====

  // GUIDANCE FIELDS
  /** Clarifying questions to better understand user intent (max 3) */
  clarifying_questions?: string[];
  /** Clickable action suggestions (RE-ENABLED in v3.2.0) */
  suggested_actions?: SuggestedAction[];
  /** Diagnostic commands user can run (troubleshooting mode) */
  suggested_commands?: CommandSuggestion[];
  /** Command validation response */
  command_validation?: CommandValidation | null;

  // PROBLEM DETECTION (Phase 0)
  /** Whether problem signals detected in user query */
  problem_detected?: boolean;
  /** Brief problem summary if detected */
  problem_summary?: string | null;
  /** Problem severity if detected */
  severity?: 'low' | 'medium' | 'high' | 'critical' | null;

  // PHASE CONTROL
  /** Whether current phase objectives are met */
  phase_complete?: boolean;
  /** Whether to advance to next phase */
  should_advance?: boolean;

  // HYPOTHESIS TRACKING (Phase 3-4)
  /** New hypotheses generated this turn (Phase 3) */
  new_hypotheses?: Hypothesis[];
  /** Hypothesis being tested (Phase 4 - Validation) */
  hypothesis_tested?: string | null;
  /** Test result with outcome and confidence impact */
  test_result?: TestResult | null;

  // SCOPE ASSESSMENT (Phase 1)
  /** Blast radius assessment */
  scope_assessment?: ScopeAssessment | null;

  // METADATA
  /** Response generation timestamp */
  timestamp?: string;
  /** Additional response metadata */
  response_metadata?: Record<string, any>;
}

// New dedicated title generation interfaces
export interface TitleGenerateRequest {
  session_id: string;
  context?: {
    last_user_message?: string;
    summary?: string;
    messages?: string;
    notes?: string;
  };
  max_words?: number; // 3-12, default 8
}

export interface TitleResponse {
  schema_version: string;
  title: string;
  view_state?: ViewState;
}

// Enhanced knowledge base document structure with canonical document types
export type DocumentType = 'playbook' | 'troubleshooting_guide' | 'reference' | 'how_to';

export interface KnowledgeDocument {
  document_id: string;
  title: string;
  content?: string;           // only present for GET by id or search snippet
  document_type: DocumentType;
  category?: string;
  tags: string[];
  source_url?: string;
  description?: string;
  status?: string;
  created_at?: string;        // ISO UTC
  updated_at?: string;        // ISO UTC
  metadata?: Record<string, any>;
}


export interface DocumentListResponse {
  documents: KnowledgeDocument[];
  total_count: number;
  limit: number;
  offset: number;
  filters: { document_type?: string; tags?: string[] };
}

// New error response structure
export interface APIError {
  detail: string;
  error_type?: string;
  correlation_id?: string;
  timestamp?: string;
  context?: Record<string, any>;
}

// ===== Enhanced API Functions =====

/**
 * Create a new session with client-based resumption support
 * Uses ClientSessionManager for automatic session resumption across browser restarts
 */
export async function createSession(metadata?: Record<string, any>): Promise<Session> {
  // Use ClientSessionManager for client-based session management
  const sessionResponse = await clientSessionManager.createSessionWithRecovery(metadata);

  // Return session in the expected format
  return {
    session_id: sessionResponse.session_id,
    created_at: sessionResponse.created_at,
    status: sessionResponse.status as 'active' | 'idle' | 'expired',
    last_activity: sessionResponse.last_activity,
    metadata: sessionResponse.metadata,
    user_id: sessionResponse.user_id,
    session_type: sessionResponse.session_type,
    client_id: sessionResponse.client_id,
    session_resumed: sessionResponse.session_resumed,
    message: sessionResponse.message
  };
}

/**
 * Create a new session directly (bypassing client resumption)
 * Use this when you explicitly want a fresh session
 */
export async function createFreshSession(metadata?: Record<string, any>): Promise<Session> {
  const url = new URL(`${await getApiUrl()}/api/v1/sessions/`);

  const requestBody = metadata ? { metadata } : {};

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to create session: ${response.status}`);
  }

  return response.json();
}

// REMOVED: Legacy session-based upload functions
// - uploadData() → Use uploadDataToCase() instead (case-centric, RESTful)
// - batchUploadData() → Not implemented in v2.0 architecture (use uploadDataToCase multiple times)
// These functions used deprecated endpoints:
//   - POST /api/v1/data/upload (legacy session-based)
//   - POST /api/v1/data/batch-upload (not supported in v2.0)
// Modern v2.0 endpoint: POST /api/v1/cases/{case_id}/data

/**
 * Get session data with pagination
 */
export async function getSessionData(sessionId: string, limit: number = 10, offset: number = 0): Promise<UploadedData[]> {
  const url = new URL(`${await getApiUrl()}/api/v1/data/sessions/${sessionId}`);
  url.searchParams.append('limit', limit.toString());
  url.searchParams.append('offset', offset.toString());

  const response = await authenticatedFetch(url.toString(), {
    method: 'GET'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get session data: ${response.status}`);
  }

  const data = await response.json();
  // Ensure we always return an array
  return Array.isArray(data) ? data : [];
}

// KB management functions removed - use faultmaven-dashboard instead

/**
 * Get individual knowledge base document by ID
 */
export async function getKnowledgeDocument(documentId: string): Promise<KnowledgeDocument> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/knowledge/documents/${documentId}`, {
    method: 'GET'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get document: ${response.status}`);
  }

  return response.json();
}

// updateKnowledgeDocument, deleteKnowledgeDocument, searchKnowledgeBase removed - use dashboard

// ===== User-Scoped Knowledge Base Functions =====
// All user KB management functions removed - use faultmaven-dashboard instead

/**
 * Get session details
 */
export async function getSession(sessionId: string): Promise<Session> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/sessions/${sessionId}`, {
    method: 'GET'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get session: ${response.status}`);
  }

  return response.json();
}

/**
 * Delete a session
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/sessions/${sessionId}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to delete session: ${response.status}`);
  }
} 

// ===== Chat and Cases: Types and Functions required by UI =====
export interface UserCase {
  case_id: string;
  status: string;
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical' | string;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string;
  message_count?: number;
  owner_id: string;                  // NOW REQUIRED - authorization security
  // session_id REMOVED - cases are session-independent (v2.0)
}

/**
 * User-Facing Case Status Types (4 states)
 * Based on FRONTEND_CASE_STATUS_DROPDOWN_GUIDE.md
 * Note: Different from CaseStatus enum which is used for investigation phases
 */
export type UserCaseStatus =
  | 'consulting'      // Q&A mode, exploring issue
  | 'investigating'   // Active troubleshooting (Phases 1-5)
  | 'resolved'        // Closed with root cause + solution
  | 'closed';         // Closed without resolution

/**
 * Allowed status transitions
 * Terminal states (resolved, closed) have no transitions
 */
export const ALLOWED_TRANSITIONS: Record<UserCaseStatus, UserCaseStatus[]> = {
  consulting: ['investigating', 'closed'],
  investigating: ['resolved', 'closed'],
  resolved: [],     // Terminal
  closed: []        // Terminal
};

/**
 * Human-readable status labels
 */
export const STATUS_LABELS: Record<UserCaseStatus, string> = {
  consulting: 'Consulting',
  investigating: 'Investigating',
  resolved: 'Resolved',
  closed: 'Closed'
};

/**
 * Status descriptions for tooltips
 */
export const STATUS_DESCRIPTIONS: Record<UserCaseStatus, string> = {
  consulting: 'Q&A mode - exploring the issue',
  investigating: 'Active troubleshooting - systematic investigation',
  resolved: 'Issue resolved with root cause and solution',
  closed: 'Case closed without resolution'
};

/**
 * Predefined messages for status change requests
 * Sent to agent as regular queries (Option A - FRONTEND_STATUS_CHANGE_CONFIRMATION_FLOW.md)
 */
export const STATUS_CHANGE_MESSAGES: Record<string, string> = {
  'consulting_to_investigating': 'I want to start a formal investigation to find the root cause.',
  'consulting_to_closed': "Close this case. I don't need further investigation.",
  'investigating_to_resolved': 'The issue is resolved. Generate final documentation with root cause and solution.',
  'investigating_to_closed': 'Close this case as unresolved. Summarize what we found so far.'
};

/**
 * Get valid transitions for current status
 */
export function getValidTransitions(currentStatus: string): UserCaseStatus[] {
  const normalizedStatus = normalizeStatus(currentStatus);
  return ALLOWED_TRANSITIONS[normalizedStatus] || [];
}

/**
 * Get status change message for a transition
 */
export function getStatusChangeMessage(from: string, to: string): string | null {
  const fromNormalized = normalizeStatus(from);
  const toNormalized = normalizeStatus(to);
  const key = `${fromNormalized}_to_${toNormalized}`;
  return STATUS_CHANGE_MESSAGES[key] || null;
}

/**
 * Check if a status is terminal (no transitions allowed)
 */
export function isTerminalStatus(status: string): boolean {
  const normalized = normalizeStatus(status);
  return normalized === 'resolved' || normalized === 'closed';
}

/**
 * Normalize status string to UserCaseStatus type
 * Handles various backend representations
 */
export function normalizeStatus(status: string): UserCaseStatus {
  const normalized = status.toLowerCase();

  // Backend returns: consulting | investigating | resolved | closed
  // Just validate and return, no mapping needed
  if (normalized === 'consulting') {
    return 'consulting';
  }
  if (normalized === 'investigating') {
    return 'investigating';
  }
  if (normalized === 'resolved' || normalized === 'closed_resolved') {
    return 'resolved';
  }
  if (normalized === 'closed' || normalized === 'unresolved' || normalized === 'closed_unresolved') {
    return 'closed';
  }

  // Default to consulting for unknown statuses
  console.warn('[normalizeStatus] Unknown status:', status, '- defaulting to consulting');
  return 'consulting';
}

/**
 * Generate default case name in format: Case-MMDD-N
 * Example: Case-1028-1, Case-1028-2
 *
 * @param existingCases - List of existing cases to determine next sequential number
 * @returns Default case name
 */
export function generateDefaultCaseName(existingCases?: UserCase[]): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${month}${day}`;

  // Find existing cases with same date prefix
  const todayCases = (existingCases || []).filter(c =>
    c.title && c.title.startsWith(`Case-${datePrefix}-`)
  );

  // Extract numbers and find max
  const numbers = todayCases.map(c => {
    const match = c.title?.match(/Case-\d{4}-(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  });

  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;

  return `Case-${datePrefix}-${nextNumber}`;
}

export interface CreateCaseRequest {
  title?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, any>;
  initial_message?: string;
  // session_id REMOVED - use X-Session-ID header (v2.0)
  // owner_id NOT needed - auto-populated from session user_id (v2.0)
}

export async function createCase(data: CreateCaseRequest): Promise<UserCase> {
  const response = await authenticatedFetchWithRetry(`${await getApiUrl()}/api/v1/cases`, {
    method: 'POST',
    body: JSON.stringify(data || {}),
    credentials: 'include'
  });
  const corr = response.headers.get('x-correlation-id') || response.headers.get('X-Correlation-ID');
  console.log('[API] createCase', { status: response.status, correlationId: corr });
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({} as any));
    throw new Error(errorData.detail || `Failed to create case: ${response.status}`);
  }
  const json = await response.json().catch(() => ({} as any));
  if (json && json.case && json.case.case_id) {
    return json.case as UserCase;
  }
  if (json && json.case_id) {
    return json as UserCase;
  }
  throw new Error('Invalid CaseResponse shape from server');
}


export async function submitQueryToCase(caseId: string, request: QueryRequest): Promise<AgentResponse> {
  if (!request?.query) {
    throw new Error('Missing required field: query');
  }

  // Map old QueryRequest to new CreateTurnRequest format
  const body = {
    message: request.query,  // Changed: query → message
    attachments: request.context?.uploaded_data_ids?.map(id => ({ file_id: id })) || undefined
    // Removed: session_id, priority, context (auth handled by backend)
  };

  const response = await authenticatedFetchWithRetry(`${await getApiUrl()}/api/v1/cases/${caseId}/queries`, {
    method: 'POST',
    body: JSON.stringify(body),
    credentials: 'include'
  });
  const corr = response.headers.get('x-correlation-id') || response.headers.get('X-Correlation-ID');
  console.log('[API] *** TESTING NEW BUILD *** submitQueryToCase POST', { caseId, status: response.status, location: response.headers.get('Location'), correlationId: corr, body });

  console.log('[API] *** ABOUT TO CHECK RESPONSE STATUS ***', { status: response.status });

  // Handle validation errors explicitly
  if (response.status === 422) {
    let detail: any = 'Validation failed (422)';
    try {
      const errJson = await response.json();
      const inner = errJson?.detail?.error?.message || errJson?.detail || errJson;
      if (typeof inner === 'string') detail = inner;
      else detail = JSON.stringify(inner);
    } catch {}
    throw new Error(`422 Unprocessable Entity: ${detail}`);
  }

  // Configuration for polling with exponential backoff
  const POLL_INITIAL_MS = Number((import.meta as any).env?.VITE_POLL_INITIAL_MS ?? 1500);
  const POLL_BACKOFF = Number((import.meta as any).env?.VITE_POLL_BACKOFF ?? 1.5);
  const POLL_MAX_MS = Number((import.meta as any).env?.VITE_POLL_MAX_MS ?? 10000);
  const POLL_MAX_TOTAL_MS = Number((import.meta as any).env?.VITE_POLL_MAX_TOTAL_MS ?? 300000); // 5 minutes

  // Handle async 202 Accepted with polling
  if (response.status === 202) {
    const location = response.headers.get('Location');
    if (!location) throw new Error('Missing Location header for async query');
    const jobUrl = new URL(location, await getApiUrl()).toString();
    let delay = POLL_INITIAL_MS;
    let elapsed = 0;
    for (let i = 0; elapsed <= POLL_MAX_TOTAL_MS; i++) {
      const res = await authenticatedFetchWithRetry(jobUrl, { method: 'GET', credentials: 'include' });
      const lcorr = res.headers.get('x-correlation-id') || res.headers.get('X-Correlation-ID');
      if (lcorr) console.log('[API] poll job', { i, correlationId: lcorr, status: res.status });
      if (res.status >= 500) {
        throw new Error(`Server error while polling job (${res.status})`);
      }
      if (res.status === 303) {
        const finalLoc = res.headers.get('Location');
        if (!finalLoc) throw new Error('Missing final resource Location');
        const finalUrl = new URL(finalLoc, await getApiUrl()).toString();
        const finalRes = await authenticatedFetchWithRetry(finalUrl, { method: 'GET', credentials: 'include' });
        const fcorr = finalRes.headers.get('x-correlation-id') || finalRes.headers.get('X-Correlation-ID');
        if (fcorr) console.log('[API] poll final', { correlationId: fcorr, status: finalRes.status });
        if (finalRes.status >= 500) {
          throw new Error(`Server error fetching final resource (${finalRes.status})`);
        }
        if (!finalRes.ok) throw new Error(`Final resource fetch failed: ${finalRes.status}`);
        const finalJson = await finalRes.json();
        if (finalJson && finalJson.content && finalJson.response_type) return finalJson as AgentResponse;
        if (finalJson?.response?.content && finalJson?.response?.response_type) return finalJson.response as AgentResponse;
        throw new Error('Unexpected final resource payload');
      }
      const json = await res.json().catch(() => ({}));
      if (json && json.content && json.response_type) return json as AgentResponse;
      if (json?.status === 'completed') {
        if (json?.response?.content && json?.response?.response_type) return json.response as AgentResponse;
        throw new Error('Completed without AgentResponse');
      }
      if (json?.status === 'failed') throw new Error(json?.error?.message || 'Query failed');
      await new Promise(r => setTimeout(r, delay));
      elapsed += delay;
      delay = Math.min(Math.floor(delay * POLL_BACKOFF), POLL_MAX_MS);
    }
    throw new Error(`Async query polling timed out after ${Math.round(POLL_MAX_TOTAL_MS/1000)}s`);
  }

  // Handle 201 Created
  if (response.status === 201) {
    console.log('[API] *** ENTERING 201 CREATED HANDLER ***');
    // First, attempt to parse an immediate AgentResponse from the body (sync processing)
    try {
      const immediate = await response.clone().json().catch(() => null);
      console.log('[API] *** IMMEDIATE RESPONSE BODY ***', { immediate, hasImmediate: !!immediate });
      if (immediate) {
        if (immediate && immediate.content && immediate.response_type) return immediate as AgentResponse;
        if (immediate?.response?.content && immediate?.response?.response_type) return immediate.response as AgentResponse;

        // Defensive: Detect API contract violations in 201 immediate response
        if (immediate.choices && Array.isArray(immediate.choices) && immediate.choices[0]?.message?.content) {
          console.error('[API] CONTRACT VIOLATION: Backend returned OpenAI format in 201 immediate response', {
            received: { choices: immediate.choices.length, model: immediate.model },
            expected: { response_type: 'string', content: 'string', session_id: 'string' },
            correlationId: response.headers.get('x-correlation-id'),
            caseId
          });
          throw new Error('Backend API contract violation: Expected AgentResponse format but received OpenAI completion format in 201 response. Please check backend implementation.');
        }
      }
    } catch {}
    // If no immediate body result, and there is a Location header, poll created resource
    console.log('[API] *** CHECKING FOR LOCATION HEADER ***');
    const createdLoc = response.headers.get('Location');
    console.log('[API] *** LOCATION HEADER ***', { createdLoc, hasLocation: !!createdLoc });
    if (createdLoc) {
      const createdUrl = new URL(createdLoc, await getApiUrl()).toString();
      console.log('[API] DEBUG: Starting polling for created resource:', { createdUrl, caseId });
      // Poll the created resource until it contains an AgentResponse or redirects to final
      let delay = POLL_INITIAL_MS;
      let elapsed = 0;
      for (let i = 0; elapsed <= POLL_MAX_TOTAL_MS; i++) {
        console.log('[API] DEBUG: Polling attempt', i, 'to', createdUrl);
        const createdRes = await authenticatedFetchWithRetry(createdUrl, { method: 'GET', credentials: 'include' });
        const ccorr = createdRes.headers.get('x-correlation-id') || createdRes.headers.get('X-Correlation-ID');
        if (ccorr) console.log('[API] poll created', { i, correlationId: ccorr, status: createdRes.status });
        if (createdRes.status >= 500) {
          throw new Error(`Server error on created resource (${createdRes.status})`);
        }
        if (createdRes.status === 303) {
          const finalLoc = createdRes.headers.get('Location');
          if (!finalLoc) throw new Error('Missing final resource Location');
          const finalUrl = new URL(finalLoc, await getApiUrl()).toString();
          const finalRes = await authenticatedFetchWithRetry(finalUrl, { method: 'GET', credentials: 'include' });
          const fcorr = finalRes.headers.get('x-correlation-id') || finalRes.headers.get('X-Correlation-ID');
          if (fcorr) console.log('[API] poll final', { correlationId: fcorr, status: finalRes.status });
          if (finalRes.status >= 500) {
            throw new Error(`Server error fetching final resource (${finalRes.status})`);
          }
          if (!finalRes.ok) throw new Error(`Final resource fetch failed: ${finalRes.status}`);
          const finalJson = await finalRes.json().catch(() => ({}));
          console.log('[API] DEBUG: Final polling response received:', { status: finalRes.status, json: finalJson, caseId });

          // Check for contract violations in final polling response
          if (finalJson.choices && Array.isArray(finalJson.choices) && finalJson.choices[0]?.message?.content) {
            console.error('[API] CONTRACT VIOLATION: Backend returned OpenAI format in final polling response', {
              received: { choices: finalJson.choices.length, model: finalJson.model },
              expected: { response_type: 'string', content: 'string', session_id: 'string' },
              correlationId: finalRes.headers.get('x-correlation-id'),
              caseId
            });
            throw new Error('Backend API contract violation: Expected AgentResponse format but received OpenAI completion format in final polling response.');
          }

          if (finalJson && finalJson.content && finalJson.response_type) return finalJson as AgentResponse;
          if (finalJson?.response?.content && finalJson?.response?.response_type) return finalJson.response as AgentResponse;
          throw new Error('Unexpected final resource payload');
        }
        if (createdRes.status === 200) {
          const createdJson = await createdRes.json().catch(() => ({}));
          console.log('[API] DEBUG: Polling response received:', { status: createdRes.status, json: createdJson, caseId });

          // Check for contract violations in polling response
          if (createdJson.choices && Array.isArray(createdJson.choices) && createdJson.choices[0]?.message?.content) {
            console.error('[API] CONTRACT VIOLATION: Backend returned OpenAI format in polling response', {
              received: { choices: createdJson.choices.length, model: createdJson.model },
              expected: { response_type: 'string', content: 'string', session_id: 'string' },
              correlationId: createdRes.headers.get('x-correlation-id'),
              caseId
            });
            throw new Error('Backend API contract violation: Expected AgentResponse format but received OpenAI completion format in polling response.');
          }

          if (createdJson && createdJson.content && createdJson.response_type) return createdJson as AgentResponse;
          if (createdJson?.response?.content && createdJson?.response?.response_type) return createdJson.response as AgentResponse;
          // If the created resource returns a job envelope, continue polling
          if (createdJson?.status && createdJson?.status !== 'failed') {
            await new Promise(r => setTimeout(r, delay));
            elapsed += delay;
            delay = Math.min(Math.floor(delay * POLL_BACKOFF), POLL_MAX_MS);
            continue;
          }
          if (createdJson?.status === 'failed') throw new Error(createdJson?.error?.message || 'Query failed');
        }
        await new Promise(r => setTimeout(r, delay));
        elapsed += delay;
        delay = Math.min(Math.floor(delay * POLL_BACKOFF), POLL_MAX_MS);
      }
      throw new Error(`Created query polling timed out after ${Math.round(POLL_MAX_TOTAL_MS/1000)}s`);
    }
    // No body result and no Location — fall through to generic handling
  }

  // Fallback: expect a body with AgentResponse or CreateTurnResponse
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to submit query to case: ${response.status}`);
  }
  const json = await response.json();
  console.log('[API] DEBUG: Raw backend response:', { status: response.status, json, caseId });

  // Handle new /turns endpoint CreateTurnResponse format
  if (json.agent_response && json.turn_number !== undefined) {
    console.log('[API] Mapping CreateTurnResponse to AgentResponse');
    const turnResponse = json as {
      agent_response: string;
      turn_number: number;
      milestones_completed: string[];
      case_status: string;
      progress_made: boolean;
      is_stuck: boolean;
    };

    return {
      content: turnResponse.agent_response,
      response_type: ResponseType.ANSWER,
      session_id: request.session_id,
      case_id: caseId,
      confidence_score: turnResponse.progress_made ? 0.8 : 0.5,
      sources: [],
      evidence_requests: [],
      investigation_mode: InvestigationMode.ACTIVE_INCIDENT,  // Required field
      case_status: turnResponse.case_status as any,  // Map from backend case_status
      metadata: {
        turn_number: turnResponse.turn_number,
        milestones_completed: turnResponse.milestones_completed,
        is_stuck: turnResponse.is_stuck
      }
    } as AgentResponse;
  }

  // Defensive: Detect API contract violations
  if (json.choices && Array.isArray(json.choices) && json.choices[0]?.message?.content) {
    console.error('[API] CONTRACT VIOLATION: Backend returned OpenAI format instead of AgentResponse format', {
      received: { choices: json.choices.length, model: json.model },
      expected: { response_type: 'string', content: 'string', session_id: 'string' },
      correlationId: response.headers.get('x-correlation-id'),
      caseId
    });
    throw new Error('Backend API contract violation: Expected AgentResponse format but received OpenAI completion format. Please check backend implementation.');
  }

  // Validate required AgentResponse fields per OpenAPI spec
  // Note: session_id is required at root level, not just in view_state
  if (!json.content || !json.response_type || !json.session_id) {
    console.error('[API] CONTRACT VIOLATION: Invalid AgentResponse format', {
      received: json,
      missing: {
        content: !json.content,
        response_type: !json.response_type,
        session_id: !json.session_id
      },
      correlationId: response.headers.get('x-correlation-id'),
      caseId
    });
    throw new Error('Backend API contract violation: AgentResponse missing required fields (content, response_type, session_id)');
  }

  console.log('[API] DEBUG: Valid AgentResponse received:', { content: json.content?.substring(0, 100), response_type: json.response_type });
  return json as AgentResponse;
}

export async function uploadDataToCase(
  caseId: string,
  sessionId: string,
  file: File,
  sourceMetadata?: SourceMetadata,
  description?: string
): Promise<UploadedData> {
  const form = new FormData();
  form.append('session_id', sessionId);
  form.append('file', file);
  if (description) form.append('description', description);
  if (sourceMetadata) form.append('source_metadata', JSON.stringify(sourceMetadata));
  const response = await authenticatedFetchWithRetry(`${await getApiUrl()}/api/v1/cases/${caseId}/data`, { method: 'POST', body: form, credentials: 'include' });
  if (response.status === 202) {
    const jobLocation = response.headers.get('Location');
    if (!jobLocation) throw new Error('Missing job Location header');
    for (let i = 0; i < 20; i++) {
      const jobRes = await authenticatedFetchWithRetry(jobLocation, { method: 'GET', credentials: 'include' });
      const jobJson = await jobRes.json();
      if (jobJson.status === 'completed' && jobJson.result) return jobJson.result;
      if (jobJson.status === 'failed') throw new Error(jobJson.error?.message || 'Upload job failed');
      await new Promise(r => setTimeout(r, 1500));
    }
    throw new Error('Upload job polling timed out');
  }
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    // Enhanced error message for 404 - case not found
    if (response.status === 404) {
      throw new Error('Case not found: Please refresh and try again');
    }
    throw new Error(errorData.detail || `Failed to upload data to case: ${response.status}`);
  }
  return response.json();
}

// ===== Report Generation API Functions (FR-CM-006) =====

/**
 * Get intelligent report recommendations for a resolved case
 */
export async function getReportRecommendations(caseId: string): Promise<ReportRecommendation> {
  const response = await authenticatedFetch(
    `${await getApiUrl()}/api/v1/cases/${caseId}/report-recommendations`,
    {
      method: 'GET',
      credentials: 'include'
    }
  );

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get report recommendations: ${response.status}`);
  }

  return response.json();
}

/**
 * Generate reports for a case
 */
export async function generateReports(
  caseId: string,
  request: ReportGenerationRequest
): Promise<ReportGenerationResponse> {
  const response = await authenticatedFetch(
    `${await getApiUrl()}/api/v1/cases/${caseId}/reports`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      credentials: 'include'
    }
  );

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to generate reports: ${response.status}`);
  }

  return response.json();
}

/**
 * List all reports for a case
 */
export async function getCaseReports(
  caseId: string,
  includeHistory: boolean = false
): Promise<CaseReport[]> {
  const url = new URL(`${await getApiUrl()}/api/v1/cases/${caseId}/reports`);
  if (includeHistory) {
    url.searchParams.append('include_history', 'true');
  }

  const response = await authenticatedFetch(url.toString(), {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get case reports: ${response.status}`);
  }

  return response.json();
}

/**
 * Download a specific report
 */
export async function downloadReport(
  caseId: string,
  reportId: string
): Promise<Blob> {
  const response = await authenticatedFetch(
    `${await getApiUrl()}/api/v1/cases/${caseId}/reports/${reportId}/download`,
    {
      method: 'GET',
      credentials: 'include'
    }
  );

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to download report: ${response.status}`);
  }

  return response.blob();
}

/**
 * Close a case and finalize reports
 */
export async function closeCase(
  caseId: string,
  request: CaseClosureRequest
): Promise<CaseClosureResponse> {
  const response = await authenticatedFetch(
    `${await getApiUrl()}/api/v1/cases/${caseId}/close`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      credentials: 'include'
    }
  );

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to close case: ${response.status}`);
  }

  return response.json();
}

export async function heartbeatSession(sessionId: string): Promise<void> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/sessions/${sessionId}/heartbeat`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to heartbeat session: ${response.status}`);
  }
}

/**
 * Case-scoped title generation
 */
export async function generateCaseTitle(
  caseId: string,
  options?: { max_words?: number; hint?: string }
): Promise<{ title: string; source?: string }> {
  const body: Record<string, any> = {};
  if (options?.max_words) body.max_words = options.max_words;
  if (options?.hint) body.hint = options.hint;
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/cases/${caseId}/title`, {
    method: 'POST',
    body: Object.keys(body).length ? JSON.stringify(body) : undefined,
    credentials: 'include'
  });
  if (response.status === 422) {
    throw new Error('Insufficient context to generate title');
  }
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to generate case title: ${response.status}`);
  }
  const result: TitleResponse = await response.json();
  const t = (result?.title || '').trim();
  const source = response.headers.get('x-title-source') || undefined;
  return { title: t, source }; // source: 'llm', 'fallback', or 'existing'
}

// ===== Auth types for login/verification =====
export interface AuthUser {
  user_id: string;
  email: string;
  name: string;
}

export interface UserProfile {
  user_id: string;
  username: string;
  email: string;
  display_name: string;
  created_at: string;
  is_dev_user: boolean;
  roles?: string[]; // User roles for access control
}

// Backend response structure from /api/v1/auth/dev-login
export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  session_id: string;
  user: UserProfile;
}


export async function devLogin(
  username: string,
  email?: string,
  displayName?: string
): Promise<AuthTokenResponse> {
  try {
    const response = await fetch(`${await getApiUrl()}/api/v1/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        email,
        display_name: displayName
      }),
      credentials: 'include'
    });

    if (!response.ok) {
      const errorData: APIError = await response.json().catch(() => ({}));
      const error: any = new Error(errorData.detail || `Login failed: ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const authResponse = await response.json();

    // Store auth state using new AuthManager
    const authState: AuthState = {
      access_token: authResponse.access_token,
      token_type: authResponse.token_type,
      expires_at: Date.now() + (authResponse.expires_in * 1000),
      user: authResponse.user
    };

    await authManager.saveAuthState(authState);

    return authResponse;
  } catch (error) {
    // Wrap network errors with better messaging
    if (error instanceof TypeError && error.message.includes('fetch')) {
      const networkError: any = new Error('Unable to connect to server');
      networkError.name = 'NetworkError';
      networkError.originalError = error;
      throw networkError;
    }
    throw error;
  }
}


export async function getCurrentUser(): Promise<UserProfile> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/auth/me`, {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get current user: ${response.status}`);
  }

  return response.json();
}

export async function logoutAuth(): Promise<void> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/auth/logout`, {
    method: 'POST',
    credentials: 'include'
  });

  // Clear auth state regardless of response status
  await authManager.clearAuthState();

  // Broadcast auth state change to other tabs
  if (typeof browser !== 'undefined' && browser.runtime) {
    try {
      await browser.runtime.sendMessage({
        type: 'auth_state_changed',
        authState: null
      });
    } catch (error) {
      // Ignore messaging errors - not critical for logout
      console.warn('[API] Failed to broadcast logout:', error);
    }
  }

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Logout failed: ${response.status}`);
  }
}

// ===== Sessions listing (sidebar initial load compatibility) =====
export async function listSessions(filters?: {
  user_id?: string;
  session_type?: string;
  usage_type?: string;
  limit?: number;
  offset?: number;
}): Promise<Session[]> {
  const url = new URL(`${await getApiUrl()}/api/v1/sessions/`);
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.append(k, String(v));
    });
  }
  const response = await authenticatedFetch(url.toString(), { method: 'GET' });
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to list sessions: ${response.status}`);
  }
  const data = await response.json().catch(() => []);
  if (Array.isArray(data)) return data as Session[];
  if (data && Array.isArray(data.sessions)) return data.sessions as Session[];
  if (data && Array.isArray(data.items)) return data.items as Session[];
  return [];
}

// ===== Global cases listing for sidebar =====
export async function getUserCases(filters?: {
  status?: string;
  priority?: string;
  limit?: number;
  offset?: number;
}): Promise<UserCase[]> {
  const url = new URL(`${await getApiUrl()}/api/v1/cases`);
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.append(k, String(v));
    });
  }
  const response = await authenticatedFetch(url.toString(), { method: 'GET', credentials: 'include' });
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get cases: ${response.status}`);
  }
  const data = await response.json().catch(() => ({ cases: [] }));

  // Per OpenAPI spec: backend returns CaseListResponse { cases, total_count, limit, offset, has_more }
  console.log('[API] getUserCases raw response:', {
    hasData: !!data,
    hasCasesProperty: 'cases' in data,
    casesIsArray: Array.isArray(data?.cases),
    casesLength: data?.cases?.length,
    fullData: data
  });

  if (!data || typeof data !== 'object') {
    console.error('[API] getUserCases: Invalid response format - not an object');
    return [];
  }

  if (!('cases' in data)) {
    console.error('[API] getUserCases: Missing cases property in response');
    return [];
  }

  if (!Array.isArray(data.cases)) {
    console.error('[API] getUserCases: cases property is not an array');
    return [];
  }

  return data.cases as UserCase[];
} 

export async function archiveCase(caseId: string): Promise<void> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/cases/${caseId}/archive`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to archive case: ${response.status}`);
  }
} 

export async function deleteCase(caseId: string): Promise<void> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/cases/${caseId}`, {
    method: 'DELETE',
    credentials: 'include'
  });

  const corr = response.headers.get('x-correlation-id') || response.headers.get('X-Correlation-ID');
  console.log('[API] deleteCase', { caseId, status: response.status, correlationId: corr });

  if (!response.ok && response.status !== 204) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to delete case: ${response.status}`);
  }
} 

export interface CaseUpdateRequest {
  title?: string;
  description?: string;
  status?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export async function updateCaseTitle(caseId: string, title: string): Promise<void> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/cases/${caseId}`, {
    method: 'PUT',
    body: JSON.stringify({ title } as CaseUpdateRequest),
    credentials: 'include'
  });
  const corr = response.headers.get('x-correlation-id') || response.headers.get('X-Correlation-ID');
  console.log('[API] updateCaseTitle', { caseId, status: response.status, correlationId: corr });
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to update case: ${response.status}`);
  }
}

export async function getCaseConversation(caseId: string, includeDebug: boolean = false): Promise<any> {
  const url = new URL(`${await getApiUrl()}/api/v1/cases/${caseId}/messages`);
  if (includeDebug) {
    url.searchParams.set('include_debug', 'true');
  }

  const response = await authenticatedFetch(url.toString(), {
    method: 'GET',
    credentials: 'include'
  });

  const corr = response.headers.get('x-correlation-id') || response.headers.get('X-Correlation-ID');
  const messageCount = response.headers.get('X-Message-Count');
  const retrievedCount = response.headers.get('X-Retrieved-Count');
  const storageStatus = response.headers.get('X-Storage-Status');

  console.log('[API] getCaseConversation (enhanced)', {
    caseId,
    status: response.status,
    correlationId: corr,
    messageCount,
    retrievedCount,
    storageStatus,
    includeDebug
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get case conversation: ${response.status}`);
  }

  const data = await response.json();

  // Enhanced logging for debugging recovery issues
  console.log('[API] getCaseConversation response:', {
    caseId,
    totalCount: data.total_count,
    retrievedCount: data.retrieved_count,
    hasMore: data.has_more,
    messagesLength: data.messages?.length || 0,
    debugInfo: data.debug_info,
    storageStatus
  });

  // Log potential recovery issues
  if (data.total_count > 0 && data.retrieved_count === 0) {
    console.error('[API] Message retrieval failure detected:', {
      caseId,
      totalCount: data.total_count,
      retrievedCount: data.retrieved_count,
      debugInfo: data.debug_info
    });
  }

  return data;
}

// ===== Working Memory v3.1.0: Utility Functions =====

/**
 * Format data type for display with emoji
 */
export function formatDataType(dataType: DataType | string): string {
  const labels: Record<DataType, string> = {
    logs_and_errors: "📋 Logs & Errors",
    unstructured_text: "📝 Text",
    structured_config: "⚙️ Configuration",
    metrics_and_performance: "📊 Metrics",
    source_code: "💻 Source Code",
    visual_evidence: "🖼️ Screenshot",
    unanalyzable: "❓ Unknown Format"
  };

  return labels[dataType as DataType] || dataType;
}

/**
 * Format compression ratio for display
 */
export function formatCompression(ratio?: number): string {
  if (!ratio || ratio < 1.5) return "";
  return `(${ratio.toFixed(1)}x compressed)`;
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

 