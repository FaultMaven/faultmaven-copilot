import config from "../config";

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
}

export interface CreateSessionResponse {
  session_id: string;
  created_at: string;
  status: string;
}

// New enhanced data structures based on OpenAPI spec
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
}

export interface DataUploadResponse {
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

export interface ViewState {
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

// New enhanced AgentResponse based on v3.1.0 API
export interface AgentResponse {
  response_type: ResponseType;
  content: string;
  session_id: string;
  case_id?: string;
  confidence_score?: number;
  sources?: Source[];
  plan?: PlanStep;
  estimated_time_to_resolution?: string;
  next_action_hint?: string;
  view_state?: ViewState;
  metadata?: Record<string, any>;
}

// Enhanced troubleshooting response for backward compatibility
export interface TroubleshootingResponse {
  response: string;
  findings?: Array<{
    details?: string;
    message?: string;
    [key: string]: any;
  }>;
  recommendations?: string[];
  confidence_score?: number;
  session_id: string;
}

// Enhanced knowledge base document structure
export interface KbDocument {
  document_id: string;
  title: string;
  content: string;
  document_type: string;
  category?: string;
  status: string;
  tags: string[];
  source_url?: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, any>;
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
 * Create a new session with enhanced metadata support
 */
export async function createSession(metadata?: Record<string, any>): Promise<Session> {
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
export async function processQuery(request: QueryRequest): Promise<AgentResponse> {
  const response = await fetch(`${config.apiUrl}/api/v1/agent/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to process query: ${response.status}`);
  }

  return response.json();
}

/**
 * Legacy troubleshooting endpoint for backward compatibility
 */
export async function troubleshoot(request: QueryRequest): Promise<TroubleshootingResponse> {
  const response = await fetch(`${config.apiUrl}/api/v1/agent/troubleshoot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to troubleshoot: ${response.status}`);
  }

  return response.json();
}

/**
 * Enhanced data upload with new endpoint and response structure
 */
export async function uploadData(sessionId: string, data: File | string, dataType: 'file' | 'text' | 'page'): Promise<UploadedData> {
  const formData = new FormData();
  formData.append('session_id', sessionId);
  
  if (data instanceof File) {
    formData.append('file', data);
  } else {
    // For text/page content, create a text file
    const blob = new Blob([data], { type: 'text/plain' });
    const file = new File([blob], 'content.txt', { type: 'text/plain' });
    formData.append('file', file);
  }

  const response = await fetch(`${config.apiUrl}/api/v1/data/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
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

  const response = await fetch(`${config.apiUrl}/api/v1/data/batch-upload`, {
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

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
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
 * Enhanced knowledge base document upload
 */
export async function uploadKnowledgeDocument(
  file: File,
  title: string,
  documentType: string = 'troubleshooting_guide',
  category?: string,
  tags?: string[],
  sourceUrl?: string,
  description?: string
): Promise<KbDocument> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', title);
  formData.append('document_type', documentType);
  
  if (category) formData.append('category', category);
  if (tags) formData.append('tags', tags.join(','));
  if (sourceUrl) formData.append('source_url', sourceUrl);
  if (description) formData.append('description', description);

  const response = await fetch(`${config.apiUrl}/api/v1/knowledge/documents`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Upload failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Enhanced knowledge base document retrieval
 */
export async function getKnowledgeDocuments(
  documentType?: string,
  tags?: string[],
  limit: number = 50,
  offset: number = 0
): Promise<KbDocument[]> {
  const url = new URL(`${config.apiUrl}/api/v1/knowledge/documents`);
  
  if (documentType) url.searchParams.append('document_type', documentType);
  if (tags) url.searchParams.append('tags', tags.join(','));
  url.searchParams.append('limit', limit.toString());
  url.searchParams.append('offset', offset.toString());

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to fetch documents: ${response.status}`);
  }

  const data = await response.json();
  // Ensure we always return an array
  return Array.isArray(data) ? data : [];
}

/**
 * Enhanced knowledge base document deletion
 */
export async function deleteKnowledgeDocument(documentId: string): Promise<void> {
  const response = await fetch(`${config.apiUrl}/api/v1/knowledge/documents/${documentId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to delete document: ${response.status}`);
  }
}

/**
 * Search knowledge base documents
 */
export async function searchKnowledgeBase(
  query: string,
  documentType?: string,
  category?: string,
  tags?: string[],
  limit: number = 10
): Promise<KbDocument[]> {
  const response = await fetch(`${config.apiUrl}/api/v1/knowledge/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      document_type: documentType,
      category,
      tags: tags ? tags.join(',') : undefined,
      limit,
    }),
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Search failed: ${response.status}`);
  }

  const result = await response.json();
  const documents = result.documents || result;
  // Ensure we always return an array
  return Array.isArray(documents) ? documents : [];
}

/**
 * Get session details
 */
export async function getSession(sessionId: string): Promise<Session> {
  const response = await fetch(`${config.apiUrl}/api/v1/sessions/${sessionId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
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
  const response = await fetch(`${config.apiUrl}/api/v1/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to delete session: ${response.status}`);
  }
}

/**
 * Send heartbeat to keep session alive
 */
export async function heartbeatSession(sessionId: string): Promise<void> {
  const response = await fetch(`${config.apiUrl}/api/v1/sessions/${sessionId}/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to heartbeat session: ${response.status}`);
  }
}

/**
 * Get session statistics
 */
export async function getSessionStats(sessionId: string): Promise<Record<string, any>> {
  const response = await fetch(`${config.apiUrl}/api/v1/sessions/${sessionId}/stats`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get session stats: ${response.status}`);
  }

  return response.json();
}

/**
 * Cleanup session data
 */
export async function cleanupSession(sessionId: string): Promise<void> {
  const response = await fetch(`${config.apiUrl}/api/v1/sessions/${sessionId}/cleanup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to cleanup session: ${response.status}`);
  }
}

/**
 * Get user cases with filtering
 */
export async function getUserCases(filters?: {
  status?: string;
  priority?: string;
  limit?: number;
  offset?: number;
}): Promise<Array<{
  case_id: string;
  session_id: string;
  status: string;
  title: string;
  description?: string;
  priority?: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
}>> {
  const url = new URL(`${config.apiUrl}/api/v1/cases`);
  
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get cases: ${response.status}`);
  }

  return response.json();
}

/**
 * Mark case as resolved
 */
export async function markCaseResolved(caseId: string): Promise<{
  case_id: string;
  status: string;
  resolved_at: string;
}> {
  const response = await fetch(`${config.apiUrl}/api/v1/cases/${caseId}/resolve`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to resolve case: ${response.status}`);
  }

  return response.json();
}

/**
 * List sessions with optional filtering for multi-conversation support
 */
export async function listSessions(filters?: {
  user_id?: string;
  session_type?: string;
  usage_type?: string;
  limit?: number;
  offset?: number;
}): Promise<Session[]> {
  const url = new URL(`${config.apiUrl}/api/v1/sessions/`);
  
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData: APIError = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Failed to list sessions: ${response.status}`);
    }

    const data = await response.json();
    
    // Handle different possible response formats
    let sessions: Session[] = [];
    
    if (Array.isArray(data)) {
      sessions = data;
    } else if (data && Array.isArray(data.sessions)) {
      sessions = data.sessions;
    } else if (data && Array.isArray(data.items)) {
      sessions = data.items;
    } else {
      console.warn('[listSessions] Unexpected response format:', data);
      return [];
    }
    
    // Validate and sanitize session objects
    return sessions.map(session => ({
      session_id: session.session_id || '',
      created_at: session.created_at || new Date().toISOString(),
      status: session.status || 'active',
      last_activity: session.last_activity,
      metadata: session.metadata || {},
      user_id: session.user_id,
      session_type: session.session_type,
      usage_type: session.usage_type
    })).filter(session => session.session_id); // Filter out invalid sessions
    
  } catch (error) {
    console.error('[listSessions] Error:', error);
    throw error;
  }
}

/**
 * Generate AI-powered conversation title
 */
export async function generateConversationTitle(sessionId: string): Promise<{ title: string }> {
  const response = await fetch(`${config.apiUrl}/api/v1/agent/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session_id: sessionId,
      query: "Please generate a concise, descriptive title (3-6 words) for this troubleshooting conversation based on the key issue or topic discussed. Return only the title without quotes or extra text.",
      priority: "low",
      context: {
        is_title_generation: true
      }
    }),
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to generate title: ${response.status}`);
  }

  const result: AgentResponse = await response.json();
  return { title: result.content.trim() };
}

/**
 * Health check endpoint
 */
export async function healthCheck(): Promise<Record<string, any>> {
  const response = await fetch(`${config.apiUrl}/health`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }

  return response.json();
} 