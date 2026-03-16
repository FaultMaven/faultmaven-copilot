import { getApiUrl } from "../../../config";
import { UserCase, UserCaseStatus } from "../../../types/case";
import { authenticatedFetchWithRetry, prepareBody } from "../client";
import { createLogger } from "../../utils/logger";
import { caseCacheManager } from "../../cache/case-cache";
import { HttpError, createHttpErrorFromResponse } from "../../errors/http-error";
import {
  APIError,
  CaseUpdateRequest,
  CreateCaseRequest,
  TitleResponse,
  TurnRequest,
  TurnResponse,
} from "../types";

const log = createLogger('CaseService');


/**
 * Allowed case actions (phase transitions and dispositions)
 */
export const ALLOWED_ACTIONS: Record<UserCaseStatus, UserCaseStatus[]> = {
  inquiry: ['investigating', 'closed', 'resolved'],  // 'resolved' = fast-track KB resolution
  investigating: ['resolved', 'closed'],
  resolved: [],     // Disposition — terminal
  closed: []        // Disposition — terminal
};
/** @deprecated Use ALLOWED_ACTIONS */
export const ALLOWED_TRANSITIONS = ALLOWED_ACTIONS;

/**
 * Human-readable status labels
 */
export const STATUS_LABELS: Record<UserCaseStatus, string> = {
  inquiry: 'Inquiry',
  investigating: 'Investigating',
  resolved: 'Resolved',
  closed: 'Closed'
};

/**
 * Status descriptions for tooltips
 */
export const STATUS_DESCRIPTIONS: Record<UserCaseStatus, string> = {
  inquiry: 'Q&A mode - exploring the issue',
  investigating: 'Active troubleshooting - systematic investigation',
  resolved: 'Issue resolved with root cause and solution',
  closed: 'Case closed — see closure reason for details'
};

/**
 * Investigation stage display info for INVESTIGATING substage pill.
 * Maps InvestigationStage enum values → user-facing label, icon, and pill style.
 */
export const STAGE_DISPLAY_INFO: Record<string, { label: string; pillClass: string }> = {
  diagnosis: {
    label: 'Diagnosing',
    pillClass: 'border border-fm-accent-border bg-fm-accent-soft text-fm-accent',
  },
  mitigation: {
    label: 'Mitigating',
    pillClass: 'border border-fm-warning-border bg-fm-warning-bg text-fm-warning',
  },
  treatment: {
    label: 'Resolving',
    pillClass: 'border border-fm-success-border bg-fm-success-bg text-fm-success',
  },
};

/**
 * Closure reason display info for CLOSED status pill and ClosedDetails banner.
 */
export const CLOSURE_DISPLAY_INFO: Record<string, { label: string; bannerClass: string; description: string }> = {
  mitigation_sufficient: {
    label: 'Mitigated',
    bannerClass: 'bg-fm-warning-bg border border-fm-warning-border text-fm-warning',
    description: 'Temporary mitigation applied; root cause investigation deferred.',
  },
  abandoned: {
    label: 'Abandoned',
    bannerClass: 'bg-fm-surface border border-fm-border text-fm-text-tertiary',
    description: 'Investigation stopped without reaching a conclusion.',
  },
  escalated: {
    label: 'Escalated',
    bannerClass: 'bg-fm-info-bg border border-fm-info-border text-fm-info',
    description: 'Case escalated to another team or external support.',
  },
  inquiry_only: {
    label: 'Inquiry Only',
    bannerClass: 'bg-fm-surface border border-fm-border text-fm-text-tertiary',
    description: 'Q&A session completed, no investigation needed.',
  },
  duplicate: {
    label: 'Duplicate',
    bannerClass: 'bg-fm-surface border border-fm-border text-fm-text-tertiary',
    description: 'Duplicate of another case.',
  },
  other: {
    label: 'Other',
    bannerClass: 'bg-fm-surface border border-fm-border text-fm-text-tertiary',
    description: 'Case closed.',
  },
};

/**
 * Evidence source type display info (for EvidenceSummary.type badge).
 */
export const EVIDENCE_TYPE_DISPLAY_INFO: Record<string, { label: string; shortLabel: string; badgeClass: string }> = {
  log_file: { label: 'Logs', shortLabel: 'LOG', badgeClass: 'bg-fm-accent-soft text-fm-accent border border-fm-accent-border' },
  metrics_data: { label: 'Metrics', shortLabel: 'MET', badgeClass: 'bg-fm-success-bg text-fm-success border border-fm-success-border' },
  config_file: { label: 'Config', shortLabel: 'CFG', badgeClass: 'bg-fm-warning-bg text-fm-warning border border-fm-warning-border' },
  trace_data: { label: 'Traces', shortLabel: 'TRC', badgeClass: 'bg-fm-info-bg text-fm-info border border-fm-info-border' },
  error_output: { label: 'Errors', shortLabel: 'ERR', badgeClass: 'bg-fm-critical-bg text-fm-critical border border-fm-critical-border' },
  screenshot: { label: 'Image', shortLabel: 'IMG', badgeClass: 'bg-fm-surface text-fm-text-primary border border-fm-border' },
  api_response: { label: 'API', shortLabel: 'API', badgeClass: 'bg-fm-accent-soft text-fm-accent border border-fm-accent-border' },
  monitoring_alert: { label: 'Alert', shortLabel: 'ALT', badgeClass: 'bg-fm-critical-bg text-fm-critical border border-fm-critical-border' },
  database_query: { label: 'DB', shortLabel: 'DBQ', badgeClass: 'bg-fm-info-bg text-fm-info border border-fm-info-border' },
  code_review: { label: 'Code', shortLabel: 'COD', badgeClass: 'bg-fm-accent-soft text-fm-accent border border-fm-accent-border' },
  user_report: { label: 'Report', shortLabel: 'RPT', badgeClass: 'bg-fm-surface text-fm-text-primary border border-fm-border' },
};

/** Get evidence type display info with fallback for unknown types */
export function getEvidenceTypeInfo(type: string): { label: string; shortLabel: string; badgeClass: string } {
  return EVIDENCE_TYPE_DISPLAY_INFO[type] || {
    label: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    shortLabel: type.replace(/_/g, '').slice(0, 3).toUpperCase(),
    badgeClass: 'bg-fm-surface text-fm-text-primary border border-fm-border',
  };
}

/**
 * Predefined messages for case actions (used for display only)
 * Actual backend routing uses structured QueryIntent
 */
export const CASE_ACTION_MESSAGES: Record<string, string> = {
  'inquiry_to_investigating': 'I want to start a formal investigation to find the root cause.',
  'inquiry_to_closed': "Close this case. I don't need further investigation.",
  'investigating_to_resolved': 'The issue is resolved. Generate final documentation with root cause and solution.',
  'investigating_to_closed': 'Close this case as unresolved. Summarize what we found so far.'
};
/** @deprecated Use CASE_ACTION_MESSAGES */
export const STATUS_CHANGE_MESSAGES = CASE_ACTION_MESSAGES;

/**
 * Get valid case actions for current status
 */
export function getValidActions(currentStatus: string): UserCaseStatus[] {
  const normalizedStatus = normalizeStatus(currentStatus);
  return ALLOWED_ACTIONS[normalizedStatus] || [];
}
/** @deprecated Use getValidActions */
export const getValidTransitions = getValidActions;

/**
 * Get agent message for a case action
 */
export function getCaseActionMessage(from: string, to: string): string | null {
  const fromNormalized = normalizeStatus(from);
  const toNormalized = normalizeStatus(to);
  const key = `${fromNormalized}_to_${toNormalized}`;
  return CASE_ACTION_MESSAGES[key] || null;
}
/** @deprecated Use getCaseActionMessage */
export const getStatusChangeMessage = getCaseActionMessage;

/**
 * Check if a status is a disposition (terminal)
 */
export function isDisposition(status: string): boolean {
  const normalized = normalizeStatus(status);
  return normalized === 'resolved' || normalized === 'closed';
}
/** @deprecated Use isDisposition */
export const isTerminalStatus = isDisposition;

/**
 * Normalize status string to UserCaseStatus type
 */
export function normalizeStatus(status: string | undefined | null): UserCaseStatus {
  if (!status) {
    log.warn('Empty status, defaulting to inquiry');
    return 'inquiry';
  }
  const normalized = status.toLowerCase();

  // Phases (active work)
  if (normalized === 'inquiry' || normalized === 'consulting') return 'inquiry'; // 'consulting' is legacy
  if (normalized === 'investigating') return 'investigating';
  // Dispositions (terminal)
  if (normalized === 'resolved' || normalized === 'closed_resolved') return 'resolved'; // 'closed_resolved' is legacy
  if (normalized === 'closed' || normalized === 'unresolved' || normalized === 'closed_unresolved') return 'closed'; // legacy variants

  log.warn('Unknown status, defaulting to inquiry', { status });
  return 'inquiry';
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

  // OPTIMIZATION: Check cache first for default listing (no special filters)
  // Only cache the main case list (no offset/limit or default ones)
  const isDefaultList = !filters ||
    (Object.keys(filters).length === 0) ||
    (Object.keys(filters).every(k => k === 'limit' || k === 'offset'));

  if (isDefaultList) {
    const cached = await caseCacheManager.getCachedCases();
    if (cached) {
      log.info('Returning cached case list');
      return cached;
    }
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

  // Map API CaseSummary fields to UserCase interface
  // API returns user_id, UserCase expects owner_id
  // Updated 2026-01-30: Include organization_id, closure_reason, closed_at per backend storage fixes
  const userCases = data.cases.map((c: any) => ({
    case_id: c.case_id,
    title: c.title,
    status: normalizeStatus(c.status),
    created_at: c.created_at,
    updated_at: c.updated_at,
    description: c.description,
    priority: c.priority,
    resolved_at: c.resolved_at,
    message_count: c.current_turn || c.message_count || 0,
    owner_id: c.user_id || c.owner_id || '',  // API uses user_id
    organization_id: c.organization_id || '',  // Multi-tenant field per commit b434152a
    closure_reason: c.closure_reason ?? null,  // Terminal state field per commit b434152a
    closed_at: c.closed_at ?? null  // Terminal state timestamp per commit b434152a
  }));

  // Update cache if this was a default list
  if (isDefaultList) {
    await caseCacheManager.setCachedCases(userCases);
  }

  return userCases;
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

  // Parse response - API returns CaseSummary directly per OpenAPI spec
  const caseData = await response.json();

  // Validate response matches API contract: CaseSummary with case_id at root
  if (!caseData || !caseData.case_id) {
    log.error('Invalid CaseResponse: missing case_id', { hasResponse: !!caseData });
    throw new Error('Invalid CaseResponse shape from server');
  }

  // Map API field names to UserCase interface
  // API returns user_id, UserCase expects owner_id
  // Updated 2026-01-30: Include organization_id, closure_reason, closed_at per backend storage fixes
  const userCase: UserCase = {
    case_id: caseData.case_id,
    title: caseData.title,
    status: normalizeStatus(caseData.status),
    created_at: caseData.created_at,
    updated_at: caseData.updated_at,
    description: caseData.description,
    priority: caseData.priority,
    resolved_at: caseData.resolved_at,
    message_count: caseData.current_turn || caseData.message_count || 0,
    owner_id: caseData.user_id || caseData.owner_id || '',  // API uses user_id
    organization_id: caseData.organization_id || '',  // Multi-tenant field per commit b434152a
    closure_reason: caseData.closure_reason ?? null,  // Terminal state field per commit b434152a
    closed_at: caseData.closed_at ?? null  // Terminal state timestamp per commit b434152a
  };

  // CONTRACT VALIDATION: Backend MUST provide title per API contract
  if (!userCase.title) {
    throw new Error(
      'Backend contract violation: title is required in response (openapi.locked.yaml:6132). ' +
      'Backend must auto-generate title when not provided in request (openapi.locked.yaml:5909).'
    );
  }

  // Optimistically add to cache
  await caseCacheManager.addOptimisticCase(userCase);

  return userCase;
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

/**
 * Delete a case by ID.
 *
 * @param caseId - The ID of the case to delete
 * @throws {HttpError} With status 409 if duplicate delete request
 * @throws {HttpError} For other HTTP errors
 */
export async function deleteCase(caseId: string): Promise<void> {
  const response = await authenticatedFetchWithRetry(`${await getApiUrl()}/api/v1/cases/${caseId}`, {
    method: 'DELETE',
    credentials: 'include'
  });

  if (!response.ok && response.status !== 204) {
    // Throw structured HttpError with status code
    throw await createHttpErrorFromResponse(response);
  }

  // Invalidate cache after successful delete
  await caseCacheManager.invalidateCache();
}

export async function updateCaseTitle(caseId: string, title: string): Promise<void> {
  const response = await authenticatedFetchWithRetry(`${await getApiUrl()}/api/v1/cases/${caseId}`, {
    method: 'PUT',
    body: prepareBody({ title } as CaseUpdateRequest),
    credentials: 'include'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    // Invalidate cache on failure to ensure consistency 
    await caseCacheManager.invalidateCache();
    throw new Error(errorData.detail || `Failed to update case: ${response.status}`);
  }

  // Optimistically update cache on success
  await caseCacheManager.updateOptimisticCase(caseId, { title });
}

/**
 * Update case status with terminal state validation
 * Added 2026-01-30: Handle closure_reason and closed_at for terminal states per commit b434152a
 */
export async function updateCaseStatus(
  caseId: string,
  status: UserCaseStatus,
  closureReason?: string
): Promise<void> {
  const isTerminal = isDisposition(status);

  // Validate disposition requirements per backend validation (models.py:3158-3202)
  if (isTerminal && !closureReason) {
    throw new Error('Dispositions (resolved/closed) require closure_reason');
  }

  const updateData: CaseUpdateRequest = {
    status,
    closure_reason: closureReason,
    closed_at: isTerminal ? new Date().toISOString() : undefined
  };

  const response = await authenticatedFetchWithRetry(`${await getApiUrl()}/api/v1/cases/${caseId}`, {
    method: 'PUT',
    body: prepareBody(updateData),
    credentials: 'include'
  });

  if (response.status === 422) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(`Validation failed: ${errorData.detail || 'Invalid status transition'}`);
  }

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to update case status: ${response.status}`);
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

/**
 * Submit a turn to a case investigation.
 *
 * Unified endpoint that replaces both /queries and /data.
 * A turn consists of an optional query and/or optional attachments.
 * Attachments are preprocessed through Tier 0+1 before the LLM sees them.
 *
 * @param caseId - Target case ID
 * @param request - Turn request with optional query, files, pasted content, and intent
 * @returns TurnResponse with agent response, turn number, and attachment results
 *
 * @example
 * ```typescript
 * // Query-only turn
 * const response = await submitTurn('case-123', {
 *   query: 'What could cause this error?'
 * });
 *
 * // File upload with query
 * const response = await submitTurn('case-123', {
 *   query: 'Analyze these logs',
 *   files: [logFile]
 * });
 *
 * // Pasted data without query (implicit query generated)
 * const response = await submitTurn('case-123', {
 *   pastedContent: '2026-02-22 ERROR: Connection refused...'
 * });
 * ```
 */
export async function submitTurn(caseId: string, request: TurnRequest): Promise<TurnResponse> {
  const hasQuery = request.query && request.query.trim();
  const hasFiles = request.files && request.files.length > 0;
  const hasPasted = request.pastedContent && request.pastedContent.trim();

  if (!hasQuery && !hasFiles && !hasPasted) {
    throw new Error('Turn must include at least one of: query, files, or pastedContent');
  }

  const form = new FormData();
  if (hasQuery) form.append('query', request.query!.trim());
  if (hasPasted) form.append('pasted_content', request.pastedContent!);
  if (request.intentType) form.append('intent_type', request.intentType);
  if (request.intentData) form.append('intent_data', JSON.stringify(request.intentData));
  if (request.inputType) form.append('input_type', request.inputType);
  if (request.sourceUrl) form.append('source_url', request.sourceUrl);
  for (const file of request.files || []) {
    form.append('files', file);
  }

  const response = await authenticatedFetchWithRetry(`${await getApiUrl()}/api/v1/cases/${caseId}/turns`, {
    method: 'POST',
    body: form,
    credentials: 'include'
  });

  if (response.status === 422) {
    let detail: any = 'Validation failed (422)';
    try {
      const errJson = await response.json();
      const inner = errJson?.detail?.error?.message || errJson?.detail || errJson;
      if (typeof inner === 'string') detail = inner;
      else detail = JSON.stringify(inner);
    } catch { }
    throw new Error(`422 Unprocessable Entity: ${detail}`);
  }

  const POLL_INITIAL_MS = Number((import.meta as any).env?.VITE_POLL_INITIAL_MS ?? 1500);
  const POLL_BACKOFF = Number((import.meta as any).env?.VITE_POLL_BACKOFF ?? 1.5);
  const POLL_MAX_MS = Number((import.meta as any).env?.VITE_POLL_MAX_MS ?? 10000);
  const POLL_MAX_TOTAL_MS = Number((import.meta as any).env?.VITE_POLL_MAX_TOTAL_MS ?? 300000);

  // Handle async 202 Accepted with polling
  if (response.status === 202) {
    const location = response.headers.get('Location');
    if (!location) throw new Error('Missing Location header for async turn');
    const jobUrl = new URL(location, await getApiUrl()).toString();
    let delay = POLL_INITIAL_MS;
    let elapsed = 0;
    while (elapsed <= POLL_MAX_TOTAL_MS) {
      const res = await authenticatedFetchWithRetry(jobUrl, { method: 'GET', credentials: 'include' });
      if (res.status >= 500) {
        throw new Error(`Server error while polling job (${res.status})`);
      }
      const json = await res.json().catch(() => ({}));
      if (isTurnResponse(json)) return json;
      if (json?.status === 'completed' && json?.result && isTurnResponse(json.result)) return json.result;
      if (json?.status === 'failed') throw new Error(json?.error?.message || 'Turn processing failed');
      await new Promise(r => setTimeout(r, delay));
      elapsed += delay;
      delay = Math.min(Math.floor(delay * POLL_BACKOFF), POLL_MAX_MS);
    }
    throw new Error(`Async turn polling timed out after ${Math.round(POLL_MAX_TOTAL_MS / 1000)}s`);
  }

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    if (response.status === 404) {
      throw new Error('Case not found: Please refresh and try again');
    }
    throw new Error(errorData.detail || `Failed to submit turn: ${response.status}`);
  }

  return response.json();
}

function isTurnResponse(obj: any): obj is TurnResponse {
  return obj && typeof obj.agent_response === 'string' && typeof obj.turn_number === 'number';
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

  // Invalidate cache to show new title immediately (Scenario 1 in requirements)
  // or update optimistically if we trust the response
  if (t) {
    await caseCacheManager.updateOptimisticCase(caseId, { title: t });
  }

  return { title: t, source };
}
