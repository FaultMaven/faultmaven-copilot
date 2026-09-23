import { getApiTransport } from '../transport';
import type { components, operations } from "../../../types/api.generated";
import { Message, UserCase, UserCaseState } from "../../../types/case";
import { authenticatedFetchWithRetry, prepareBody } from "../client";
import { createLogger } from "../../utils/logger";
import { caseCacheManager } from "../../cache/case-cache";
import { createHttpErrorFromResponse } from "../../errors/http-error";
import { errorBodyText } from "../../errors/error-body";
import { isRetryableError } from "../../utils/retry";
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
 * Canonical page size for the primary "recent case list" fetch. The single-slot
 * case cache is only valid for this exact page shape (offset 0, this limit), so
 * the UI callers that populate/read the cache and the cache-eligibility check
 * must share one source of truth for it — otherwise a differently-paged fetch
 * (e.g. limit:50) would overwrite the cache with a shorter slice that a limit:100
 * caller then reads back as the full list.
 */
export const DEFAULT_CASE_LIST_LIMIT = 100;


/**
 * Allowed case actions (phase transitions and dispositions)
 */
/**
 * Case actions a USER may select — selectability, not legality.
 *
 * Only `closed`, from either phase, because closing is the one decision that
 * needs no precondition. The two legal edges absent here are absent for the
 * same reason: a menu cannot honour an edge whose precondition is a fact about
 * the case.
 *
 * ``investigating`` is refused by every backend since #1608; ``resolved`` is refused from contract 9.0.0, which this repo pins.
 *
 * - `investigating` is earned by a confirmed problem statement (Gate 1).
 * - `resolved` is earned by a confirmed root-cause elimination and offered by
 *   the agent through the confirm/decline handshake. Resolving is something
 *   the user SAYS, not something they click.
 *
 * (`resolved` was also removed from INQUIRY in backend v3 — the "fast-track KB
 * resolution" it referred to routes through INVESTIGATING via the milestone
 * collapse.)
 */
export const ALLOWED_ACTIONS: Record<UserCaseState, UserCaseState[]> = {
  inquiry: ['closed'],
  investigating: ['closed'],
  resolved: [],     // Disposition — terminal
  closed: []        // Disposition — terminal
};
/** @deprecated Use ALLOWED_ACTIONS */
export const ALLOWED_TRANSITIONS = ALLOWED_ACTIONS;

/**
 * Human-readable status labels
 */
export const STATUS_LABELS: Record<UserCaseState, string> = {
  inquiry: 'Inquiry',
  investigating: 'Investigating',
  resolved: 'Resolved',
  closed: 'Closed'
};

/**
 * Status descriptions for tooltips
 */
export const STATUS_DESCRIPTIONS: Record<UserCaseState, string> = {
  inquiry: 'Q&A mode - exploring the issue',
  investigating: 'Active troubleshooting - systematic investigation',
  resolved: 'Issue resolved with root cause and solution',
  closed: 'Case closed — see closure reason for details'
};

/**
 * Investigation stage display info for INVESTIGATING substage pill.
 * Maps InvestigationStage enum values → user-facing label and pill style.
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
 * Closure reason display info — the single source of truth for closure-reason
 * display across the extension (CLOSED status pill, CaseDetails closure row, and
 * the ResolutionActionsCard compact banner via `shortLabel`).
 *
 * The real keys mirror VALID_CLOSURE_REASONS in
 * faultmaven/modules/case/domain/models.py exactly (inquiry_only,
 * solution_deferred, closed_rca_infeasible, mitigation_sufficient,
 * closed_insufficient_evidence). `label` is the full
 * descriptive form; `shortLabel` is the compact form for contexts already
 * prefixed with "Closed". The 'other' fallback is a defensive default for cases
 * where closure_reason is null/unrecognized (used by HeaderSummary and
 * ResolutionActionsCard; CaseDetails suppresses the closure row in that case).
 */
export const CLOSURE_DISPLAY_INFO: Record<string, { label: string; shortLabel: string; description: string }> = {
  inquiry_only: {
    label: 'Inquiry Only',
    shortLabel: 'Inquiry Only',
    description: 'Q&A session completed, no investigation needed.',
  },
  solution_deferred: {
    label: 'Fix deferred',
    shortLabel: 'Fix Deferred',
    description: 'Cause identified and a fix documented; implementation happens out-of-band.',
  },
  closed_rca_infeasible: {
    label: 'Root cause unreachable',
    shortLabel: 'Cause Unreachable',
    description: 'The cause cannot be reached for this problem; the mitigation is the accepted strategy.',
  },
  mitigation_sufficient: {
    label: 'Stabilized by mitigation',
    shortLabel: 'Stabilized',
    description: 'A verified mitigation relieved the symptom; root-cause analysis was deferred.',
  },
  closed_restatement_held: {
    label: 'Cause not stated distinctly',
    shortLabel: 'Not Distinct',
    description:
      'The evidence supported a cause, but it was never stated distinctly from the problem — what was missing was a mechanism, not more data.',
  },
  closed_insufficient_evidence: {
    label: 'Insufficient evidence',
    shortLabel: 'Insufficient Evidence',
    description: 'Closed without establishing the problem or its cause; the honest partial is preserved.',
  },
  // Defensive fallback used when closure_reason is null/unrecognized.
  other: {
    label: 'Other',
    shortLabel: 'Closed',
    description: 'Case closed.',
  },
};

/**
 * Resolve a closure reason to something renderable — never undefined.
 *
 * Every consumer needs the same degrade-to-`other` behaviour, and hand-rolling
 * it three times is what let one of them drift: CaseDetails required a map hit
 * and so dropped its Closure row entirely for a reason the build did not know,
 * while ResolutionActionsCard and HeaderSummary fell back. That row is shown
 * only when the closure summary was SKIPPED, i.e. when it is the user's only
 * signal of why the case closed.
 *
 * An unknown reason is not hypothetical: a case can still carry a value retired
 * from the backend vocabulary, and the backend can add a reason before this
 * extension ships.
 */
export function closureDisplayFor(reason: string | null | undefined) {
  return (reason && CLOSURE_DISPLAY_INFO[reason]) || CLOSURE_DISPLAY_INFO.other;
}

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
  'inquiry_to_closed': "Close this case. I don't need further investigation.",
  'investigating_to_closed': 'Close this case as unresolved. Summarize what we found so far.'
};
/** @deprecated Use CASE_ACTION_MESSAGES */
export const STATUS_CHANGE_MESSAGES = CASE_ACTION_MESSAGES;

/**
 * Get valid case actions for current status
 */
export function getValidActions(currentStatus: string): UserCaseState[] {
  const normalizedStatus = normalizeState(currentStatus);
  return ALLOWED_ACTIONS[normalizedStatus] || [];
}
/** @deprecated Use getValidActions */
export const getValidTransitions = getValidActions;

/**
 * Get agent message for a case action
 */
export function getCaseActionMessage(from: string, to: string): string | null {
  const fromNormalized = normalizeState(from);
  const toNormalized = normalizeState(to);
  const key = `${fromNormalized}_to_${toNormalized}`;
  return CASE_ACTION_MESSAGES[key] || null;
}
/** @deprecated Use getCaseActionMessage */
export const getStatusChangeMessage = getCaseActionMessage;

/**
 * Check if a status is a disposition (terminal)
 */
export function isDisposition(status: string): boolean {
  const normalized = normalizeState(status);
  return normalized === 'resolved' || normalized === 'closed';
}
/** @deprecated Use isDisposition */
export const isTerminalStatus = isDisposition;

/**
 * Normalize status string to UserCaseState type
 */
export function normalizeState(status: string | undefined | null): UserCaseState {
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

/**
 * A case row as the server serves it: `CaseSummary` on the list and create
 * paths, `CaseDetail` on the single-case read. Both are contract-required to
 * name the case's enterprise.
 *
 * The intersection names the three fields this mapper has always read
 * defensively and NO published schema carries — they resolve to `undefined`
 * against a 3.4.0 server and are left exactly as they were, because they are
 * not what this contract change is about.
 */
type ServerCaseRow = (
  | components["schemas"]["CaseSummary"]
  | components["schemas"]["CaseDetail"]
) & {
  priority?: string;
  message_count?: number;
  owner_id?: string;
};

/**
 * Map one backend case row to the client `UserCase`. API returns user_id;
 * UserCase expects owner_id.
 *
 * THE BOUNDARY. A case's tenant is its ENTERPRISE (ADR-017 D1/D2; contract
 * 3.0.0 made `enterprise_id` required on both row schemas), so a row that does
 * not name one is REJECTED rather than defaulted. This read used to be
 * `organization_id || ''`: a row whose tenant was missing became a case
 * belonging to `''`, and nothing downstream could tell that apart from a case
 * whose tenant really was empty. `organization_id` is carried through
 * untouched as the nullable BILLING stamp the contract still emits.
 */
function toUserCase(row: unknown): UserCase {
  const c = row as ServerCaseRow;
  if (typeof c?.enterprise_id !== 'string' || c.enterprise_id.length === 0) {
    throw new Error(
      'Contract violation: case row has no enterprise_id, the tenant a case belongs to (API contract 3.0.0)'
    );
  }
  return {
    case_id: c.case_id,
    title: c.title,
    state: normalizeState(c.state),
    created_at: c.created_at,
    updated_at: c.updated_at,
    description: c.description,
    priority: c.priority,
    resolved_at: c.resolved_at ?? undefined,
    message_count: c.current_turn || c.message_count || 0,
    owner_id: c.user_id || c.owner_id || '',  // API uses user_id
    enterprise_id: c.enterprise_id,  // Isolation tenant (ADR-017)
    organization_id: c.organization_id ?? null,  // Billing attribution only
    closure_reason: c.closure_reason ?? null,  // Terminal state field per commit b434152a
    closed_at: c.closed_at ?? null  // Terminal state timestamp per commit b434152a
  };
}

/**
 * Fetch one case by id (GET /api/v1/cases/{case_id}).
 *
 * Unlike the paginated list, this cannot miss a case ranked beyond the first
 * page and is always a fresh read. It deliberately does not read or write the
 * case-list cache — it refreshes one case, not the sidebar's list slice.
 */
export async function getCase(caseId: string): Promise<UserCase> {
  const response = await authenticatedFetchWithRetry(
    `${await getApiTransport().baseUrl()}/api/v1/cases/${encodeURIComponent(caseId)}`,
    { method: 'GET', credentials: 'include' }
  );
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({} as any));
    throw new Error(errorBodyText(errorData) || `Failed to get case: ${response.status}`);
  }
  const caseData = await response.json();
  if (!caseData || !caseData.case_id) {
    throw new Error('Invalid CaseDetail shape from server');
  }
  return toUserCase(caseData);
}

/**
 * The filter `GET /api/v1/cases` actually accepts — DERIVED from the generated
 * operation, never hand-written.
 *
 * Keys are forwarded to the query string verbatim, with no renaming, so any key
 * this type admits that the route does not declare is dropped by FastAPI
 * without a word and answered with **200 and the unfiltered list** (#271; the
 * same shape as faultmaven-dashboard#51). It used to advertise `status` and
 * `priority`, neither of which this route has ever declared — `status` being the
 * inviting one, because the real parameter is `state`, renamed in faultmaven#405.
 *
 * Deriving it makes the compiler the gate: `{ status: 'resolved' }` is a compile
 * error, and the accepted set stays correct when the contract moves without
 * anyone remembering to re-copy it. It is also the only way the real parameters
 * — `state`, `source`, `team_id`, the creation-date window, `include_empty` —
 * become expressible at all.
 */
export type CaseListFilters = NonNullable<
  operations['list_cases_api_v1_cases_get']['parameters']['query']
>;

/**
 * The same set again, as a RUNTIME table — because the compile gate above closes
 * only half the hole.
 *
 * TypeScript's excess-property check fires on a FRESH OBJECT LITERAL and nowhere
 * else. Through a variable it does not, and the weak-type check that would
 * otherwise catch an all-optional target is defeated by a single shared key.
 * Measured against this repo's own `tsc --noEmit --strict`:
 *
 *     getUserCases({ status: 'resolved', limit: 100 })                  TS2353
 *     const g = { status: 'resolved' };        getUserCases(g)          TS2559
 *     const f = { status: 'resolved', limit: 100 }; getUserCases(f)     NO ERROR
 *
 * That third line is the shape a filter actually takes — built up conditionally,
 * then passed along — so a compile-time-only gate would leave #271 reachable by
 * the most realistic route to it. The forwarder is where it has to close.
 *
 * Typed `Record<keyof CaseListFilters, true>`, so the compiler checks this table
 * against the generated operation in BOTH directions: a parameter the contract
 * adds and this omits is a missing-property error, and a key the route does not
 * declare is an excess-property error. One source of truth, two gates — which is
 * the whole claim, and a hand-kept second list would not be.
 */
const CASE_LIST_QUERY_PARAMS: Record<keyof CaseListFilters, true> = {
  state: true,
  source: true,
  team_id: true,
  created_after: true,
  created_before: true,
  limit: true,
  offset: true,
  include_empty: true,
};

/**
 * Serialize a case-list filter into `url`'s query string.
 *
 * An UNDECLARED key is dropped, and loudly. Forwarding it verbatim is #271
 * itself: FastAPI drops the unknown parameter without a word and answers 200
 * with the UNFILTERED list, so the caller believes it filtered and did not.
 * Dropping it here does not make that call correct — it makes it visible, and
 * leaves the request no worse than the silent one it replaces.
 *
 * The null guard is LOOSE (`!= null`), and that is a fix rather than a style
 * choice. The contract types every filter as `T | null` — `created_after` and
 * `created_before` since 3.8.0, `state` / `source` / `team_id` before them — so
 * `null` is how a caller says "no bound". Under the old `!== undefined` it
 * reached `String(null)` and appended the literal `created_after=null`, which
 * FastAPI parses as a datetime and refuses with a 422.
 *
 * Dates: the boundary takes ISO-8601 STRINGS, because that is what the contract
 * declares and because turning a picked day into an instant needs a timezone
 * decision only the caller can make (cf. the Dashboard's `lib/cases/dateRange.ts`,
 * where that conversion happens exactly once, in the viewer's own zone).
 * `CaseListFilters` therefore makes a `Date` a compile error. It is still
 * converted here, as a net for callers that reach this from untyped JavaScript:
 * `String(new Date())` yields "Mon Sep 14 2026 00:00:00 GMT-0700 (…)", which the
 * server cannot parse at all. An INVALID date falls back to `String()` rather
 * than `toISOString()`, which throws `RangeError` on one: that would turn a
 * server 422 the caller's error path already handles into a synchronous throw
 * out of a function nobody expects to throw, before any fetch is made. A net
 * that converts a handled failure into an unhandled one is not a net.
 */
function appendCaseListQuery(url: URL, filters: CaseListFilters): void {
  for (const [key, value] of Object.entries(filters as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(CASE_LIST_QUERY_PARAMS, key)) {
      log.warn('Dropping a filter GET /api/v1/cases does not declare', { key });
      continue;
    }
    if (value == null) continue;
    const serialized =
      value instanceof Date && !Number.isNaN(value.getTime())
        ? value.toISOString()
        : String(value);
    url.searchParams.append(key, serialized);
  }
}

export async function getUserCases(filters?: CaseListFilters): Promise<UserCase[]> {
  const url = new URL(`${await getApiTransport().baseUrl()}/api/v1/cases`);
  if (filters) appendCaseListQuery(url, filters);

  // OPTIMIZATION: Check cache first for the canonical default listing only.
  // The cache is a single slot keyed by nothing, so it may only represent exactly
  // one page shape: no other filter, offset 0, and the explicit default page
  // size. Any other request — a different limit/offset, OR a no-arg/`{}` call
  // that returns the backend-default slice (not guaranteed to equal our page size)
  // — targets a different slice and must neither read nor write this cache, else
  // e.g. a limit:50 fetch would shrink the list a limit:100 caller then reads back.
  //
  // The predicate reads the QUERY STRING this call is about to issue — `url` is
  // fully built two lines above — rather than the filter it was spelled with. It
  // therefore cannot drift from the serializer, because it reads the
  // serializer's OUTPUT. Re-deriving the skip rule here (a second `v == null`)
  // agreed with `appendCaseListQuery` only by coincidence of being written
  // twice: teach the serializer one more skip and the canonical query would stop
  // being recognised as the default page, so the sidebar's list would silently
  // stop being cached; change it the other way and a cached canonical page would
  // be served to a call that issued a NARROWED query.
  const query = url.searchParams;
  const isDefaultList =
    [...query.keys()].every(k => k === 'limit' || k === 'offset') &&
    query.get('limit') === String(DEFAULT_CASE_LIST_LIMIT) &&
    (!query.has('offset') || query.get('offset') === '0');

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
    throw new Error(errorBodyText(errorData) || `Failed to get cases: ${response.status}`);
  }
  // A 200 whose body will not parse is NOT an empty list. Substituting
  // `{ cases: [] }` here made it one, and it passed the shape guards below and
  // reached `setCachedCases([])` — because the sidebar's own fetch IS the
  // canonical default page. `[]` is truthy, so `if (cached) return cached` then
  // short-circuited every later fetch and the user's case list read empty and
  // STAYED empty until the TTL expired. `null` falls through to the guards,
  // which return [] without writing the cache. Reachable in practice: a proxy
  // error page or a `Content-Length: 0` body under an `ok` status.
  const data = await response.json().catch(() => null);

  if (!data || typeof data !== 'object') {
    return [];
  }
  if (!('cases' in data) || !Array.isArray(data.cases)) {
    return [];
  }

  const userCases = data.cases.map((c: unknown) => toUserCase(c));

  // Update cache if this was a default list
  if (isDefaultList) {
    await caseCacheManager.setCachedCases(userCases);
  }

  return userCases;
}

export async function createCase(
  data: CreateCaseRequest,
  options?: { idempotencyKey?: string }
): Promise<UserCase> {
  // An Idempotency-Key lets the backend dedupe a retried create so an ambiguous
  // network failure can be safely auto-retried without spawning a second case
  // (see submitTurn and the resilientOperation `idempotent` flag). The key must
  // match the backend format `^[a-zA-Z0-9_-]+$` (8–255 chars); optimistic ids and
  // UUIDs both satisfy it.
  const response = await authenticatedFetchWithRetry(`${await getApiTransport().baseUrl()}/api/v1/cases`, {
    method: 'POST',
    body: prepareBody(data),
    credentials: 'include',
    ...(options?.idempotencyKey
      ? { headers: { 'Idempotency-Key': options.idempotencyKey } }
      : {})
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({} as any));
    throw new Error(errorBodyText(errorData) || `Failed to create case: ${response.status}`);
  }

  // Parse response - API returns CaseSummary directly per OpenAPI spec
  const caseData = await response.json();

  // Validate response matches API contract: CaseSummary with case_id at root
  if (!caseData || !caseData.case_id) {
    log.error('Invalid CaseResponse: missing case_id', { hasResponse: !!caseData });
    throw new Error('Invalid CaseResponse shape from server');
  }

  const userCase: UserCase = toUserCase(caseData);

  // CONTRACT VALIDATION: Backend MUST provide title per API contract
  if (!userCase.title) {
    throw new Error(
      'Backend contract violation: title is required in response (openapi.locked.yaml:6132). ' +
      'Backend must auto-generate title when not provided in request (openapi.locked.yaml:5909).'
    );
  }

  // Invalidate the list cache so the sidebar refresh the create flows trigger
  // actually network-fetches and includes the new case. (The reconcile effect
  // no longer invalidates on case select, so creation must not rely on it.)
  await caseCacheManager.invalidateCache();

  // Optimistically add to cache
  await caseCacheManager.addOptimisticCase(userCase);

  return userCase;
}

/**
 * Delete a case by ID.
 *
 * @param caseId - The ID of the case to delete
 * @throws {HttpError} With status 409 if duplicate delete request
 * @throws {HttpError} For other HTTP errors
 */
export async function deleteCase(caseId: string): Promise<void> {
  const response = await authenticatedFetchWithRetry(`${await getApiTransport().baseUrl()}/api/v1/cases/${caseId}`, {
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
  const response = await authenticatedFetchWithRetry(`${await getApiTransport().baseUrl()}/api/v1/cases/${caseId}`, {
    method: 'PUT',
    body: prepareBody({ title } as CaseUpdateRequest),
    credentials: 'include'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    // Invalidate cache on failure to ensure consistency 
    await caseCacheManager.invalidateCache();
    throw new Error(errorBodyText(errorData) || `Failed to update case: ${response.status}`);
  }

  // Optimistically update cache on success
  await caseCacheManager.updateOptimisticCase(caseId, { title });
}

/**
 * One page of the backend `/messages` response. Rows are the generated
 * contract `Message` type; they carry only message-level fields — case-level
 * state is never present on them.
 */
export interface MessagesPage {
  messages?: Message[];
  total_count?: number;
  retrieved_count?: number;
  has_more?: boolean;
  debug_info?: unknown;
}

export async function getCaseConversation(
  caseId: string,
  options: { offset?: number; includeDebug?: boolean } = {}
): Promise<MessagesPage> {
  const { offset = 0, includeDebug = false } = options;
  const apiBase = await getApiTransport().baseUrl();
  const pageSize = 100; // backend per-request cap (le=100)

  // The backend `/messages` endpoint caps each request at limit<=100, so a
  // single call from `offset` only returns up to one page. For a delta fetch
  // that left newer turns unfetched until the next panel open (and on a cold
  // open it truncated the history). Drain every page from `offset` to the end
  // and return the merged delta so callers get the complete tail in one call.
  const messages: Message[] = [];
  let lastData: MessagesPage = {};

  for (let pageOffset = offset; ; pageOffset += pageSize) {
    const url = new URL(`${apiBase}/api/v1/cases/${caseId}/messages`);
    url.searchParams.set('limit', String(pageSize));
    if (pageOffset > 0) url.searchParams.set('offset', String(pageOffset));
    if (includeDebug) url.searchParams.set('include_debug', 'true');

    const response = await authenticatedFetchWithRetry(url.toString(), {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      const errorData: APIError = await response.json().catch(() => ({}));
      throw new Error(errorBodyText(errorData) || `Failed to get case conversation: ${response.status}`);
    }

    const page = (await response.json()) as MessagesPage;
    lastData = page;
    const pageMessages = page.messages ?? [];
    messages.push(...pageMessages);

    // Stop on a short page (last page) or once we've collected everything past
    // the starting offset. The short-page guard also prevents an infinite loop
    // if total_count is ever stale/larger than the real message count.
    if (pageMessages.length < pageSize || offset + messages.length >= (page.total_count ?? 0)) {
      break;
    }
  }

  const data = { ...lastData, messages, retrieved_count: messages.length, has_more: false };

  // An empty result is only unexpected on a full fetch (offset=0). When fetching
  // a delta (offset>0), retrieved_count=0 simply means nothing new arrived.
  if (offset === 0 && (data.total_count ?? 0) > 0 && data.retrieved_count === 0) {
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
export async function submitTurn(
  caseId: string,
  request: TurnRequest,
  options?: { signal?: AbortSignal; idempotencyKey?: string }
): Promise<TurnResponse> {
  const signal = options?.signal;
  const idempotencyKey = options?.idempotencyKey;
  if (signal?.aborted) throw createAbortError();
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

  const response = await authenticatedFetchWithRetry(`${await getApiTransport().baseUrl()}/api/v1/cases/${caseId}/turns`, {
    method: 'POST',
    body: form,
    credentials: 'include',
    signal,
    // Stable per-turn Idempotency-Key: the backend replays the cached response
    // (including a 202 + job Location) for a repeat, so an ambiguous network
    // failure can be auto-retried (and re-polled) without submitting a second
    // turn. Callers derive the key from the turn's stable optimistic message id
    // so auto- AND manual-retries of the same turn share one key.
    ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {})
  });

  if (response.status === 422) {
    let detail: any = 'Validation failed (422)';
    try {
      const errJson = await response.json();
      // A 422 from the turn endpoint can carry a nested engine error; prefer
      // that, then the body's ordinary text, then the raw body so nothing is
      // lost for diagnosis. `errorBodyText` returns nothing for the array of
      // field errors a plain FastAPI 422 carries, which falls through to the
      // stringify below — the same result as before, stated deliberately.
      const inner = errJson?.detail?.error?.message ?? errorBodyText(errJson) ?? errJson;
      if (typeof inner === 'string') detail = inner;
      else detail = JSON.stringify(inner);
    } catch {
      // Ignore JSON parsing errors for error body
    }
    throw new Error(`422 Unprocessable Entity: ${detail}`);
  }

  if (response.status === 409) {
    // Backend OCC conflict — another writer (typically a status change
    // from another surface) updated the case while this turn was being
    // processed. Throw typed HttpError so the hook layer can detect it
    // via the ErrorClassifier → CaseVersionConflictError path and
    // surface a soft "Case was updated; retry" message instead of a
    // generic error. Auto-retry would loop on the same conflict, so
    // CaseVersionConflictError uses manual_retry recovery.
    //
    // Note: in production, authenticatedFetchWithRetry typically throws
    // its own enriched Error for non-OK responses (see client.ts), so
    // this branch is defensive. The classifier handles both shapes via
    // the `status` property, but this branch ensures direct callers
    // that bypass the client wrapper still get a typed HttpError.
    throw await createHttpErrorFromResponse(response);
  }

  const POLL_INITIAL_MS = Number(import.meta.env.VITE_POLL_INITIAL_MS ?? 1500);
  const POLL_BACKOFF = Number(import.meta.env.VITE_POLL_BACKOFF ?? 1.5);
  const POLL_MAX_MS = Number(import.meta.env.VITE_POLL_MAX_MS ?? 10000);
  // Total async-poll budget. Matches the outermost ingress read ceiling (600s)
  // so a long-running async (202) turn is waited out to the same wall the sync
  // path allows, rather than giving up early.
  const POLL_MAX_TOTAL_MS = Number(import.meta.env.VITE_POLL_MAX_TOTAL_MS ?? 600000);

  // Handle async 202 Accepted with polling
  if (response.status === 202) {
    const location = response.headers.get('Location');
    if (!location) throw new Error('Missing Location header for async turn');
    const jobUrl = new URL(location, await getApiTransport().baseUrl()).toString();
    let delay = POLL_INITIAL_MS;
    // Budget is measured as WALL-CLOCK from the first poll, counting both the
    // time spent inside each poll request and the backoff sleeps. Previously
    // only the sleeps were counted (`elapsed += delay`), so a stalled poll —
    // which can hang up to the 300s client timeout — contributed nothing to the
    // budget and the real ceiling was effectively unbounded (many multiples of
    // POLL_MAX_TOTAL_MS). Using Date.now() bounds the loop to the intended wall.
    const startedAt = Date.now();
    while (Date.now() - startedAt <= POLL_MAX_TOTAL_MS) {
      // Caller cancelled (e.g. the side panel unmounted) — stop polling now
      // rather than continuing to hammer the job endpoint for up to 10 minutes.
      if (signal?.aborted) throw createAbortError();
      let json: any;
      try {
        // authenticatedFetchWithRetry throws an enriched HTTPError on any non-OK
        // response, so `res` here is always OK — no `res.status >= 500` branch is
        // reachable (that check was dead). The throw is what we must handle.
        const res = await authenticatedFetchWithRetry(jobUrl, { method: 'GET', credentials: 'include', signal });
        json = await res.json().catch(() => ({}));
      } catch (err: any) {
        // Caller-initiated cancellation is terminal — never keep polling.
        if (signal?.aborted || err?.name === 'AbortError') throw err;
        // A transient failure on a SINGLE poll (5xx / network blip during a pod
        // rollout) must not abandon the whole async turn — the background job may
        // still complete well within the budget. Keep polling; only a definitive
        // failure (4xx, or a terminal auth/session error) aborts.
        const terminal =
          err?.name === 'AuthenticationError' || err?.name === 'SessionExpiredError';
        if (!terminal && isRetryableError(err)) {
          await abortableDelay(delay, signal);
          delay = Math.min(Math.floor(delay * POLL_BACKOFF), POLL_MAX_MS);
          continue;
        }
        throw err;
      }
      if (isTurnResponse(json)) return json;
      if (json?.status === 'completed' && json?.result && isTurnResponse(json.result)) return json.result;
      if (json?.status === 'failed') throw new Error(json?.error?.message || 'Turn processing failed');
      await abortableDelay(delay, signal);
      delay = Math.min(Math.floor(delay * POLL_BACKOFF), POLL_MAX_MS);
    }
    throw new Error(`Async turn polling timed out after ${Math.round(POLL_MAX_TOTAL_MS / 1000)}s`);
  }

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    if (response.status === 404) {
      throw new Error('Case not found: Please refresh and try again');
    }
    throw new Error(errorBodyText(errorData) || `Failed to submit turn: ${response.status}`);
  }

  return response.json();
}

function isTurnResponse(obj: any): obj is TurnResponse {
  return obj && typeof obj.agent_response === 'string' && typeof obj.turn_number === 'number';
}

/** An AbortError whose name matches the DOMException fetch raises on abort, so
 *  the classifier / retry layer treats a cancellation as non-retryable. */
function createAbortError(): Error {
  const err = new Error('Turn submission was cancelled');
  err.name = 'AbortError';
  return err;
}

/** setTimeout wrapped so a mid-backoff cancellation resolves immediately with
 *  an AbortError instead of waiting out the (up to 10s) delay. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function generateCaseTitle(
  caseId: string,
  options?: { max_words?: number; hint?: string }
): Promise<{ title: string; source?: string }> {
  const body: Record<string, any> = {};
  if (options?.max_words) body.max_words = options.max_words;
  if (options?.hint) body.hint = options.hint;
  const response = await authenticatedFetchWithRetry(`${await getApiTransport().baseUrl()}/api/v1/cases/${caseId}/title`, {
    method: 'POST',
    body: Object.keys(body).length ? prepareBody(body) : undefined,
    credentials: 'include'
  });

  if (response.status === 422) {
    throw new Error('Insufficient context to generate title');
  }
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorBodyText(errorData) || `Failed to generate case title: ${response.status}`);
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
