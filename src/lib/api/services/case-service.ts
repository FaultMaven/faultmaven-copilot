import { getApiUrl } from "../../../config";
import { UserCase, UserCaseStatus } from "../../../types/case";
import { authenticatedFetchWithRetry, prepareBody } from "../client";
import { createLogger } from "../../utils/logger";
import { 
  AgentResponse, 
  APIError, 
  CaseUpdateRequest, 
  CreateCaseRequest, 
  InvestigationMode, 
  QueryRequest, 
  ResponseType, 
  SourceMetadata, 
  TitleResponse, 
  UploadedData 
} from "../types";

const log = createLogger('CaseService');


/**
 * Allowed status transitions
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
 */
export const STATUS_CHANGE_MESSAGES: Record<string, string> = {
  'consulting_to_investigating': 'I want to start a formal investigation to find the root cause.',
  'consulting_to_closed': "Close this case. I don't need further investigation.",
  'investigating_to_resolved': 'The issue is resolved. Generate final documentation with root cause and solution.',
  'investigating_to_closed': 'Close this case as unresolved. Summarize what we found so far.'
};

/**
 * Get valid transitions for currentStatus
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
 * Check if a status is terminal
 */
export function isTerminalStatus(status: string): boolean {
  const normalized = normalizeStatus(status);
  return normalized === 'resolved' || normalized === 'closed';
}

/**
 * Normalize status string to UserCaseStatus type
 */
export function normalizeStatus(status: string): UserCaseStatus {
  const normalized = status.toLowerCase();

  if (normalized === 'consulting') return 'consulting';
  if (normalized === 'investigating') return 'investigating';
  if (normalized === 'resolved' || normalized === 'closed_resolved') return 'resolved';
  if (normalized === 'closed' || normalized === 'unresolved' || normalized === 'closed_unresolved') return 'closed';

  log.warn('Unknown status, defaulting to consulting', { status });
  return 'consulting';
}

/**
 * Generate default case name
 */
export function generateDefaultCaseName(existingCases?: UserCase[]): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${month}${day}`;

  const todayCases = (existingCases || []).filter(c =>
    c.title && c.title.startsWith(`Case-${datePrefix}-`)
  );

  const numbers = todayCases.map(c => {
    const match = c.title?.match(/Case-\d{4}-(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  });

  const nextNumber = numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
  return `Case-${datePrefix}-${nextNumber}`;
}

// API Functions

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
  const response = await authenticatedFetchWithRetry(url.toString(), { method: 'GET', credentials: 'include' });
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get cases: ${response.status}`);
  }
  const data = await response.json().catch(() => ({ cases: [] }));

  if (!data || typeof data !== 'object') {
    return [];
  }
  if (!('cases' in data) || !Array.isArray(data.cases)) {
    return [];
  }

  return data.cases as UserCase[];
}

export async function createCase(data: CreateCaseRequest): Promise<UserCase> {
  const response = await authenticatedFetchWithRetry(`${await getApiUrl()}/api/v1/cases`, {
    method: 'POST',
    body: prepareBody(data),
    credentials: 'include'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({} as any));
    throw new Error(errorData.detail || `Failed to create case: ${response.status}`);
  }
  const json = await response.json().catch(() => ({} as any));

  let caseData: UserCase | null = null;
  if (json && json.case && json.case.case_id) {
    caseData = json.case as UserCase;
  } else if (json && json.case_id) {
    caseData = json as UserCase;
  }

  if (!caseData) {
    throw new Error('Invalid CaseResponse shape from server');
  }

  // CONTRACT VALIDATION: Backend MUST provide title per API contract
  // openapi.locked.yaml:5909 - "Case title (optional, auto-generated if not provided)"
  // Backend is required to auto-generate title if not provided in request
  if (!caseData.title) {
    throw new Error(
      'Backend contract violation: title is required in response (openapi.locked.yaml:6132). ' +
      'Backend must auto-generate title when not provided in request (openapi.locked.yaml:5909).'
    );
  }

  return caseData;
}

export async function archiveCase(caseId: string): Promise<void> {
  const response = await authenticatedFetchWithRetry(`${await getApiUrl()}/api/v1/cases/${caseId}/archive`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to archive case: ${response.status}`);
  }
}

export async function deleteCase(caseId: string): Promise<void> {
  const response = await authenticatedFetchWithRetry(`${await getApiUrl()}/api/v1/cases/${caseId}`, {
    method: 'DELETE',
    credentials: 'include'
  });

  if (!response.ok && response.status !== 204) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to delete case: ${response.status}`);
  }
}

export async function updateCaseTitle(caseId: string, title: string): Promise<void> {
  const response = await authenticatedFetchWithRetry(`${await getApiUrl()}/api/v1/cases/${caseId}`, {
    method: 'PUT',
    body: prepareBody({ title } as CaseUpdateRequest),
    credentials: 'include'
  });
  
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

  const response = await authenticatedFetchWithRetry(url.toString(), {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get case conversation: ${response.status}`);
  }

  const data = await response.json();
  
  if (data.total_count > 0 && data.retrieved_count === 0) {
    log.error('Message retrieval failure detected', {
      caseId,
      totalCount: data.total_count,
      retrievedCount: data.retrieved_count,
      debugInfo: data.debug_info
    });
  }

  return data;
}

export async function submitQueryToCase(caseId: string, request: QueryRequest): Promise<AgentResponse> {
  if (!request?.query) {
    throw new Error('Missing required field: query');
  }

  const body = {
    message: request.query,
    attachments: request.context?.uploaded_data_ids?.map(id => ({ file_id: id })) || undefined
  };

  const response = await authenticatedFetchWithRetry(`${await getApiUrl()}/api/v1/cases/${caseId}/queries`, {
    method: 'POST',
    body: prepareBody(body),
    credentials: 'include'
  });

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

  const POLL_INITIAL_MS = Number((import.meta as any).env?.VITE_POLL_INITIAL_MS ?? 1500);
  const POLL_BACKOFF = Number((import.meta as any).env?.VITE_POLL_BACKOFF ?? 1.5);
  const POLL_MAX_MS = Number((import.meta as any).env?.VITE_POLL_MAX_MS ?? 10000);
  const POLL_MAX_TOTAL_MS = Number((import.meta as any).env?.VITE_POLL_MAX_TOTAL_MS ?? 300000);

  // Handle async 202 Accepted with polling
  if (response.status === 202) {
    const location = response.headers.get('Location');
    if (!location) throw new Error('Missing Location header for async query');
    const jobUrl = new URL(location, await getApiUrl()).toString();
    let delay = POLL_INITIAL_MS;
    let elapsed = 0;
    for (let i = 0; elapsed <= POLL_MAX_TOTAL_MS; i++) {
      const res = await authenticatedFetchWithRetry(jobUrl, { method: 'GET', credentials: 'include' });
      if (res.status >= 500) {
        throw new Error(`Server error while polling job (${res.status})`);
      }
      if (res.status === 303) {
        const finalLoc = res.headers.get('Location');
        if (!finalLoc) throw new Error('Missing final resource Location');
        const finalUrl = new URL(finalLoc, await getApiUrl()).toString();
        const finalRes = await authenticatedFetchWithRetry(finalUrl, { method: 'GET', credentials: 'include' });
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
    try {
      const immediate = await response.clone().json().catch(() => null);
      if (immediate) {
        if (immediate && immediate.content && immediate.response_type) return immediate as AgentResponse;
        if (immediate?.response?.content && immediate?.response?.response_type) return immediate.response as AgentResponse;
      }
    } catch {}
    
    const createdLoc = response.headers.get('Location');
    if (createdLoc) {
      const createdUrl = new URL(createdLoc, await getApiUrl()).toString();
      let delay = POLL_INITIAL_MS;
      let elapsed = 0;
      for (let i = 0; elapsed <= POLL_MAX_TOTAL_MS; i++) {
        const createdRes = await authenticatedFetchWithRetry(createdUrl, { method: 'GET', credentials: 'include' });
        if (createdRes.status >= 500) {
          throw new Error(`Server error on created resource (${createdRes.status})`);
        }
        if (createdRes.status === 303) {
          const finalLoc = createdRes.headers.get('Location');
          if (!finalLoc) throw new Error('Missing final resource Location');
          const finalUrl = new URL(finalLoc, await getApiUrl()).toString();
          const finalRes = await authenticatedFetchWithRetry(finalUrl, { method: 'GET', credentials: 'include' });
          if (finalRes.status >= 500) {
            throw new Error(`Server error fetching final resource (${finalRes.status})`);
          }
          if (!finalRes.ok) throw new Error(`Final resource fetch failed: ${finalRes.status}`);
          const finalJson = await finalRes.json().catch(() => ({}));
          if (finalJson && finalJson.content && finalJson.response_type) return finalJson as AgentResponse;
          if (finalJson?.response?.content && finalJson?.response?.response_type) return finalJson.response as AgentResponse;
          throw new Error('Unexpected final resource payload');
        }
        if (createdRes.status === 200) {
          const createdJson = await createdRes.json().catch(() => ({}));
          if (createdJson && createdJson.content && createdJson.response_type) return createdJson as AgentResponse;
          if (createdJson?.response?.content && createdJson?.response?.response_type) return createdJson.response as AgentResponse;
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
  }

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to submit query to case: ${response.status}`);
  }
  const json = await response.json();

  if (json.agent_response && json.turn_number !== undefined) {
    const turnResponse = json;
    return {
      content: turnResponse.agent_response,
      response_type: ResponseType.ANSWER,
      session_id: request.session_id,
      case_id: caseId,
      confidence_score: turnResponse.progress_made ? 0.8 : 0.5,
      sources: [],
      evidence_requests: [],
      investigation_mode: InvestigationMode.ACTIVE_INCIDENT,
      case_status: turnResponse.case_status as any,
      metadata: {
        turn_number: turnResponse.turn_number,
        milestones_completed: turnResponse.milestones_completed,
        is_stuck: turnResponse.is_stuck
      }
    } as AgentResponse;
  }

  if (!json.content || !json.response_type || !json.session_id) {
    throw new Error('Backend API contract violation: AgentResponse missing required fields (content, response_type, session_id)');
  }

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
  
  const response = await authenticatedFetchWithRetry(`${await getApiUrl()}/api/v1/cases/${caseId}/data`, { 
    method: 'POST', 
    body: form, 
    credentials: 'include' 
  });
  
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
    if (response.status === 404) {
      throw new Error('Case not found: Please refresh and try again');
    }
    throw new Error(errorData.detail || `Failed to upload data to case: ${response.status}`);
  }
  return response.json();
}

export async function generateCaseTitle(
  caseId: string,
  options?: { max_words?: number; hint?: string }
): Promise<{ title: string; source?: string }> {
  const body: Record<string, any> = {};
  if (options?.max_words) body.max_words = options.max_words;
  if (options?.hint) body.hint = options.hint;
  const response = await authenticatedFetchWithRetry(`${await getApiUrl()}/api/v1/cases/${caseId}/title`, {
    method: 'POST',
    body: Object.keys(body).length ? prepareBody(body) : undefined,
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
  return { title: t, source }; 
}
