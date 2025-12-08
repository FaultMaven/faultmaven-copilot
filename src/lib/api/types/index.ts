// Authentication
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
    roles?: string[];
  };
}

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
  roles?: string[];
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
export type { UserCase, UserCaseStatus, CaseStatus } from "../../../types/case";
import { CaseStatus } from "../../../types/case"; // Import for usage in types

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
  owner_id: string;
}

export interface CreateCaseRequest {
  title?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, any>;
  initial_message?: string;
}

export interface CaseUpdateRequest {
  title?: string;
  description?: string;
  status?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
}

export interface Message {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  metadata?: Record<string, any>;
  author_id: string;
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
export enum EvidenceCategory {
  SYMPTOMS = 'symptoms',
  TIMELINE = 'timeline',
  CHANGES = 'changes',
  CONFIGURATION = 'configuration',
  SCOPE = 'scope',
  METRICS = 'metrics',
  ENVIRONMENT = 'environment'
}

export enum EvidenceStatus {
  PENDING = 'pending',
  PARTIAL = 'partial',
  COMPLETE = 'complete',
  BLOCKED = 'blocked',
  OBSOLETE = 'obsolete'
}

export enum InvestigationMode {
  ACTIVE_INCIDENT = 'active_incident',
  POST_MORTEM = 'post_mortem'
}

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

export interface InvestigationPhase {
  current: string;
  number: number;
}

export interface HypothesesSummary {
  total: number;
  validated: string | null;
  validated_confidence: number | null;
}

export interface AnomalyFrame {
  statement: string;
  severity: string;
  affected_components: string[];
}

export interface InvestigationProgress {
  phase: InvestigationPhase;
  engagement_mode: "consultant" | "lead_investigator";
  ooda_iteration: number;
  turn_count: number;
  case_status: CaseStatus;
  hypotheses: HypothesesSummary;
  evidence_collected: number;
  evidence_requested: number;
  anomaly_frame?: AnomalyFrame;
}

export interface AcquisitionGuidance {
  commands: string[];
  file_locations: string[];
  ui_locations: string[];
  alternatives: string[];
  prerequisites: string[];
  expected_output?: string | null;
}

export interface EvidenceRequest {
  request_id: string;
  label: string;
  description: string;
  category: EvidenceCategory;
  guidance: AcquisitionGuidance;
  status: EvidenceStatus;
  created_at_turn: number;
  updated_at_turn?: number | null;
  completeness: number;
  metadata: Record<string, any>;
}

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

export interface SuggestedAction {
  label: string;
  type: 'question_template' | 'command' | 'upload_data' | 'transition' | 'create_runbook';
  payload: string;
  icon?: string | null;
  metadata?: Record<string, any>;
}

export interface CommandSuggestion {
  command: string;
  description: string;
  why: string;
  safety: 'safe' | 'read_only' | 'caution';
  expected_output?: string | null;
}

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

export interface Hypothesis {
  statement: string;
  likelihood: number;
  supporting_evidence: string[];
  category: 'configuration' | 'code' | 'infrastructure' | 'dependency' | 'data';
  testing_strategy: string;
  status: 'pending' | 'testing' | 'validated' | 'refuted';
}

export interface TestResult {
  test_description: string;
  outcome: 'supports' | 'refutes' | 'inconclusive';
  confidence_impact: number;
  evidence_summary: string;
}

export interface ScopeAssessment {
  affected_scope: 'all_users' | 'user_subset' | 'specific_users' | 'unknown';
  affected_components: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  impact_percentage?: number | null;
  impact_description?: string | null;
}

export interface AgentResponse {
  schema_version?: string;
  content: string;
  response_type: ResponseType;
  session_id: string;
  case_id?: string | null;
  confidence_score?: number | null;
  sources?: Source[];
  plan?: PlanStep | null;
  estimated_time_to_resolution?: string;
  next_action_hint?: string | null;
  view_state?: ViewState | null;
  metadata?: Record<string, any>;
  evidence_requests: EvidenceRequest[];
  investigation_mode: InvestigationMode;
  case_status: CaseStatus;
  clarifying_questions?: string[];
  suggested_actions?: SuggestedAction[];
  suggested_commands?: CommandSuggestion[];
  command_validation?: CommandValidation | null;
  problem_detected?: boolean;
  problem_summary?: string | null;
  severity?: 'low' | 'medium' | 'high' | 'critical' | null;
  phase_complete?: boolean;
  should_advance?: boolean;
  new_hypotheses?: Hypothesis[];
  hypothesis_tested?: string | null;
  test_result?: TestResult | null;
  scope_assessment?: ScopeAssessment | null;
  timestamp?: string;
  response_metadata?: Record<string, any>;
}

export interface SourceMetadata {
  source_type: "file_upload" | "text_paste" | "page_capture";
  source_url?: string;
  captured_at?: string;
  user_description?: string;
}

export interface UploadedData {
  data_id: string;
  case_id: string;
  session_id: string;
  data_type: 'log_file' | 'error_message' | 'stack_trace' | 'metrics_data' | 'config_file' | 'documentation' | 'unknown';
  content: string;
  file_name?: string;
  file_size?: number;
  uploaded_at: string;
  processing_status: string;
  insights?: Record<string, any>;
  agent_response?: AgentResponse;
  classification?: ClassificationMetadata;
  schema_version?: string;
}

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

// Reports
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
  investigation_progress?: InvestigationProgress | null;
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
