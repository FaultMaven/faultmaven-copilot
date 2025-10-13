import config from "../config";
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

async function handleAuthError(): Promise<void> {
  // Clear stored auth data
  await authManager.clearAuthState();

  // Trigger re-authentication flow
  // This will be handled by the UI components
  throw new AuthenticationError('Authentication required - please sign in again');
}

/**
 * Enhanced fetch wrapper with auth error handling and error classification
 * Enriches errors with HTTP status codes for proper error classification
 */
async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  try {
    const headers = await getAuthHeaders();

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {})
      }
    });

    // Handle auth errors immediately
    if (response.status === 401) {
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
  // Additional fields that might be returned by backend
  user_id?: string;
  session_type?: string;
  usage_type?: string;
  // Client-based session management fields
  client_id?: string;
  session_resumed?: boolean;
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
  session_id: string;
  data_type: 'log_file' | 'error_message' | 'stack_trace' | 'metrics_data' | 'config_file' | 'documentation' | 'unknown';
  content: string;
  file_name?: string;
  file_size?: number;
  uploaded_at: string;
  processing_status: string;
  insights?: Record<string, any>;
  agent_response?: AgentResponse;  // NEW: AI analysis from backend
}

// Legacy DataUploadResponse (deprecated - use v3.1.0 version below)
export interface LegacyDataUploadResponse {
  data_id: string;
  filename?: string;
  insights?: string;
  status: string;
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
}

/**
 * Case information from backend
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
}

/**
 * Message information from backend
 */
export interface Message {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  metadata?: Record<string, any>;
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

  // ===== Legacy UI hints (backward compatibility) =====
  show_upload_button?: boolean;
  show_plan_actions?: boolean;
  show_confirmation_dialog?: boolean;
  highlighted_sections?: string[];
  custom_actions?: Array<{
    label: string;
    action: string;
    style?: string;
  }>;
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

/**
 * Response from data upload with immediate analysis
 */
export interface DataUploadResponse {
  /** Unique identifier for uploaded data */
  data_id: string;
  /** Original filename */
  filename: string;
  /** File metadata */
  file_metadata: FileMetadata;
  /** Immediate analysis results */
  immediate_analysis: ImmediateAnalysis;
  /** Present only if refuting evidence detected */
  conflict_detected?: ConflictDetection | null;
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

// Legacy troubleshooting types removed. Use `AgentResponse` for current workflows.

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

// Legacy interface for backward compatibility
export interface KbDocument extends KnowledgeDocument {
  content: string;  // Make content required for legacy compatibility
  status: string;   // Make status required for legacy compatibility
  created_at: string; // Make created_at required for legacy compatibility
  updated_at: string; // Make updated_at required for legacy compatibility
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
  const url = new URL(`${config.apiUrl}/api/v1/sessions/`);

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

/**
 * Enhanced query processing with new response types
 */
// Legacy agent routes removed. Frontend must use case-scoped APIs such as
// `submitQueryToCase(caseId, request)` which returns an `AgentResponse`.

/**
 * Enhanced data upload with new endpoint and response structure
 */
export async function uploadData(
  sessionId: string,
  caseId: string,
  data: File | string,
  dataType: 'file' | 'text' | 'page'
): Promise<UploadedData> {
  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('case_id', caseId);

  if (data instanceof File) {
    formData.append('file', data);
  } else {
    // For text/page content, create a text file
    const blob = new Blob([data], { type: 'text/plain' });
    const file = new File([blob], 'content.txt', { type: 'text/plain' });
    formData.append('file', file);
  }

  // Get auth headers but exclude Content-Type for FormData
  const authHeaders = await getAuthHeaders();
  const { 'Content-Type': _, ...headersWithoutContentType } = authHeaders as any;

  const response = await fetch(`${config.apiUrl}/api/v1/data/upload`, {
    method: 'POST',
    headers: headersWithoutContentType,
    body: formData,
  });

  if (response.status === 401) {
    await handleAuthError();
  }

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));

    // Handle 422 validation error for missing case_id
    if (response.status === 422 && errorData.detail?.includes('case_id')) {
      throw new Error('Please select or create a case before uploading data');
    }

    throw new Error(errorData.detail || `Failed to upload data: ${response.status}`);
  }

  return response.json();
}

/**
 * Batch upload multiple files
 */
export async function batchUploadData(sessionId: string, files: File[]): Promise<UploadedData[]> {
  const formData = new FormData();
  formData.append('session_id', sessionId);
  
  files.forEach((file, index) => {
    formData.append('files', file);
  });

  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/data/batch-upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to batch upload data: ${response.status}`);
  }

  return response.json();
}

/**
 * Get session data with pagination
 */
export async function getSessionData(sessionId: string, limit: number = 10, offset: number = 0): Promise<UploadedData[]> {
  const url = new URL(`${config.apiUrl}/api/v1/data/sessions/${sessionId}`);
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

/**
 * Enhanced knowledge base document upload matching API spec
 */
export async function uploadKnowledgeDocument(
  file: File,
  title: string,
  documentType: DocumentType, // Required, no default
  category?: string,
  tags?: string,
  sourceUrl?: string,
  description?: string
): Promise<KnowledgeDocument> {
  // Fix MIME type detection for common file extensions
  // This maps file extensions to the exact MIME types expected by the backend
  const getCorrectMimeType = (fileName: string, originalType: string): string => {
    if (!fileName || typeof fileName !== 'string') {
      return originalType;
    }
    
    const extension = fileName.toLowerCase().split('.').pop();
    if (!extension) {
      return originalType;
    }
    
    // Map file extensions to correct MIME types that backend accepts
    // These MIME types come from backend error: "Allowed types: text/plain, text/markdown, etc."
    const mimeTypeMap: Record<string, string> = {
      'md': 'text/markdown',
      'markdown': 'text/markdown', 
      'txt': 'text/plain',
      'log': 'text/plain',
      'json': 'application/json',
      'csv': 'text/csv',
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    
    const correctedType = mimeTypeMap[extension];
    if (correctedType) {
      if (correctedType !== originalType) {
        console.log(`[API] Corrected MIME type for ${fileName}: ${originalType} → ${correctedType}`);
      }
      return correctedType;
    }
    
    // If no extension mapping found, return original type
    return originalType;
  };

  // Create a new File object with correct MIME type if needed
  const correctMimeType = getCorrectMimeType(file.name, file.type);
  const fileToUpload = correctMimeType !== file.type 
    ? new File([file], file.name, { type: correctMimeType, lastModified: file.lastModified })
    : file;

  const formData = new FormData();
  formData.append('file', fileToUpload);
  formData.append('title', title);
  formData.append('document_type', documentType);
  
  if (category) formData.append('category', category);
  if (tags) formData.append('tags', tags);  // Already comma-separated string from UI
  if (sourceUrl) formData.append('source_url', sourceUrl);
  if (description) formData.append('description', description);

  console.log(`[API] Uploading knowledge document: ${title}`);
  console.log(`[API] Original file type: ${file.type}, Corrected type: ${fileToUpload.type}`);
  console.log(`[API] File name: ${file.name}, File size: ${file.size} bytes`);

  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/knowledge/documents`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    console.error('[API] Upload failed:', response.status, errorData);
    throw new Error(errorData.detail || `Upload failed: ${response.status}`);
  }

  const uploadedDocument = await response.json();
  console.log('[API] Document uploaded successfully:', uploadedDocument);
  return uploadedDocument;
}

/**
 * Enhanced knowledge base document retrieval with proper response handling
 */
export async function getKnowledgeDocuments(
  documentType?: string,
  tags?: string,
  limit: number = 50,
  offset: number = 0
): Promise<DocumentListResponse> {
  const url = new URL(`${config.apiUrl}/api/v1/knowledge/documents`);
  
  if (documentType) url.searchParams.append('document_type', documentType);
  if (tags) url.searchParams.append('tags', tags);
  url.searchParams.append('limit', limit.toString());
  url.searchParams.append('offset', offset.toString());

  console.log('[API] Fetching knowledge documents from:', url.toString());

  const response = await authenticatedFetch(url.toString(), {
    method: 'GET'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    console.error('[API] Failed to fetch documents:', response.status, errorData);
    throw new Error(errorData.detail || `Failed to fetch documents: ${response.status}`);
  }

  const data = await response.json();
  console.log('[API] Received knowledge documents:', data);
  
  // Handle different possible response formats and return proper DocumentListResponse
  if (data && typeof data === 'object' && data.documents && Array.isArray(data.documents)) {
    // New API format with metadata
    const response: DocumentListResponse = {
      documents: data.documents,
      total_count: data.total_count || data.documents.length,
      limit: data.limit || limit,
      offset: data.offset || offset,
      filters: data.filters || {}
    };
    console.log(`[API] Returning ${response.documents.length} documents with metadata`);
    return response;
  } else if (Array.isArray(data)) {
    // Legacy format - just array of documents
    const response: DocumentListResponse = {
      documents: data,
      total_count: data.length,
      limit: limit,
      offset: offset,
      filters: {}
    };
    console.log(`[API] Returning ${response.documents.length} documents (legacy format)`);
    return response;
  } else {
    console.warn('[API] Unexpected response format for documents:', data);
    return {
      documents: [],
      total_count: 0,
      limit: limit,
      offset: offset,
      filters: {}
    };
  }
}

/**
 * Get individual knowledge base document by ID
 */
export async function getKnowledgeDocument(documentId: string): Promise<KnowledgeDocument> {
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/knowledge/documents/${documentId}`, {
    method: 'GET'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get document: ${response.status}`);
  }

  return response.json();
}

/**
 * Update knowledge base document metadata
 */
export async function updateKnowledgeDocument(
  documentId: string,
  updates: {
    title?: string;
    content?: string;
    tags?: string;
    document_type?: DocumentType;
    category?: string;
    version?: string;
    description?: string;
  }
): Promise<KnowledgeDocument> {
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/knowledge/documents/${documentId}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to update document: ${response.status}`);
  }

  return response.json();
}

/**
 * Enhanced knowledge base document deletion
 */
export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/knowledge/documents/${documentId}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to delete document: ${response.status}`);
  }
}

/**
 * Search knowledge base documents matching API spec
 */
export async function searchKnowledgeBase(
  query: string,
  limit: number = 10,
  includeMetadata: boolean = true,
  similarityThreshold: number = 0.7,
  filters?: { category?: string; document_type?: DocumentType }
): Promise<{
  query: string;
  total_results: number;
  results: Array<{
    document_id: string;
    content: string;
    metadata: {
      title: string;
      document_type: DocumentType;
      category?: string;
      tags: string[];
      priority?: number;
    };
    similarity_score: number;
  }>;
}> {
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/knowledge/search`, {
    method: 'POST',
    body: JSON.stringify({
      query,
      limit,
      include_metadata: includeMetadata,
      similarity_threshold: similarityThreshold,
      filters: filters || {}
    }),
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Search failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Get session details
 */
export async function getSession(sessionId: string): Promise<Session> {
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/sessions/${sessionId}`, {
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
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/sessions/${sessionId}`, {
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
  session_id?: string;
  status: string;
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical' | string;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string;
  message_count?: number;
}

export interface CreateCaseRequest {
  title?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, any>;
  session_id?: string;
  initial_message?: string;
}

export async function createCase(data: CreateCaseRequest): Promise<UserCase> {
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/cases`, {
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
  if (!request?.session_id || !request?.query) {
    throw new Error('Missing required fields: session_id and query');
  }
  const body = {
    session_id: request.session_id,
    query: request.query,
    context: request.context || {},
    priority: request.priority || 'medium'
  } as const;
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/cases/${caseId}/queries`, {
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
    const jobUrl = new URL(location, config.apiUrl).toString();
    let delay = POLL_INITIAL_MS;
    let elapsed = 0;
    for (let i = 0; elapsed <= POLL_MAX_TOTAL_MS; i++) {
      const res = await authenticatedFetch(jobUrl, { method: 'GET', credentials: 'include' });
      const lcorr = res.headers.get('x-correlation-id') || res.headers.get('X-Correlation-ID');
      if (lcorr) console.log('[API] poll job', { i, correlationId: lcorr, status: res.status });
      if (res.status >= 500) {
        throw new Error(`Server error while polling job (${res.status})`);
      }
      if (res.status === 303) {
        const finalLoc = res.headers.get('Location');
        if (!finalLoc) throw new Error('Missing final resource Location');
        const finalUrl = new URL(finalLoc, config.apiUrl).toString();
        const finalRes = await authenticatedFetch(finalUrl, { method: 'GET', credentials: 'include' });
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
      const createdUrl = new URL(createdLoc, config.apiUrl).toString();
      console.log('[API] DEBUG: Starting polling for created resource:', { createdUrl, caseId });
      // Poll the created resource until it contains an AgentResponse or redirects to final
      let delay = POLL_INITIAL_MS;
      let elapsed = 0;
      for (let i = 0; elapsed <= POLL_MAX_TOTAL_MS; i++) {
        console.log('[API] DEBUG: Polling attempt', i, 'to', createdUrl);
        const createdRes = await authenticatedFetch(createdUrl, { method: 'GET', credentials: 'include' });
        const ccorr = createdRes.headers.get('x-correlation-id') || createdRes.headers.get('X-Correlation-ID');
        if (ccorr) console.log('[API] poll created', { i, correlationId: ccorr, status: createdRes.status });
        if (createdRes.status >= 500) {
          throw new Error(`Server error on created resource (${createdRes.status})`);
        }
        if (createdRes.status === 303) {
          const finalLoc = createdRes.headers.get('Location');
          if (!finalLoc) throw new Error('Missing final resource Location');
          const finalUrl = new URL(finalLoc, config.apiUrl).toString();
          const finalRes = await authenticatedFetch(finalUrl, { method: 'GET', credentials: 'include' });
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

  // Fallback: expect a body with AgentResponse
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to submit query to case: ${response.status}`);
  }
  const json = await response.json();
  console.log('[API] DEBUG: Raw backend response:', { status: response.status, json, caseId });

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
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/cases/${caseId}/data`, { method: 'POST', body: form, credentials: 'include' });
  if (response.status === 202) {
    const jobLocation = response.headers.get('Location');
    if (!jobLocation) throw new Error('Missing job Location header');
    for (let i = 0; i < 20; i++) {
      const jobRes = await authenticatedFetch(jobLocation, { method: 'GET', credentials: 'include' });
      const jobJson = await jobRes.json();
      if (jobJson.status === 'completed' && jobJson.result) return jobJson.result;
      if (jobJson.status === 'failed') throw new Error(jobJson.error?.message || 'Upload job failed');
      await new Promise(r => setTimeout(r, 1500));
    }
    throw new Error('Upload job polling timed out');
  }
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to upload data to case: ${response.status}`);
  }
  return response.json();
}

export async function heartbeatSession(sessionId: string): Promise<void> {
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/sessions/${sessionId}/heartbeat`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to heartbeat session: ${response.status}`);
  }
}

// Legacy conversation title helpers removed. Use `generateCaseTitle(caseId, options)`
// to generate case-scoped titles via the backend.
// Case-scoped title generation aligned with case-centric API
export async function generateCaseTitle(
  caseId: string,
  options?: { max_words?: number; hint?: string }
): Promise<{ title: string; source?: string }> {
  const body: Record<string, any> = {};
  if (options?.max_words) body.max_words = options.max_words;
  if (options?.hint) body.hint = options.hint;
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/cases/${caseId}/title`, {
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
}

// Backend response structure from /api/v1/auth/dev-login
export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  session_id: string;
  user: UserProfile;
}

// Legacy auth response structure (for backward compatibility)
export interface AuthViewState {
  session_id: string;
  user: AuthUser;
  active_case?: any;
  cases?: any[];
  messages?: any[];
  uploaded_data?: any[];
  show_case_selector?: boolean;
  show_data_upload?: boolean;
}

export interface AuthResponse {
  schema_version: string;
  success: boolean;
  view_state: AuthViewState;
}

export async function devLogin(
  username: string,
  email?: string,
  displayName?: string
): Promise<AuthTokenResponse> {
  try {
    const response = await fetch(`${config.apiUrl}/api/v1/auth/dev-login`, {
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

// TODO: Backend endpoint /api/v1/auth/session/{session_id} not implemented yet
// This function is kept for future implementation when session verification is available
export async function verifyAuthSession(sessionId: string): Promise<AuthResponse> {
  throw new Error('Session verification endpoint not implemented in backend yet');

  // Future implementation:
  // const response = await fetch(`${config.apiUrl}/api/v1/auth/session/${sessionId}`, {
  //   method: 'GET',
  //   headers: { 'Content-Type': 'application/json' },
  //   credentials: 'include'
  // });
  // if (!response.ok) {
  //   const errorData: APIError = await response.json().catch(() => ({}));
  //   throw new Error(errorData.detail || `Session verification failed: ${response.status}`);
  // }
  // return response.json();
}

export async function getCurrentUser(): Promise<UserProfile> {
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/auth/me`, {
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
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/auth/logout`, {
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
  const url = new URL(`${config.apiUrl}/api/v1/sessions/`);
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
  const url = new URL(`${config.apiUrl}/api/v1/cases`);
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
  const data = await response.json().catch(() => []);
  return Array.isArray(data) ? (data as UserCase[]) : [];
} 

export async function archiveCase(caseId: string): Promise<void> {
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/cases/${caseId}/archive`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to archive case: ${response.status}`);
  }
} 

export async function deleteCase(caseId: string): Promise<void> {
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/cases/${caseId}`, {
    method: 'DELETE',
    credentials: 'include'
  });
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
  const response = await authenticatedFetch(`${config.apiUrl}/api/v1/cases/${caseId}`, {
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
  const url = new URL(`${config.apiUrl}/api/v1/cases/${caseId}/messages`);
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