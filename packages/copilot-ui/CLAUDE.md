# packages/copilot-ui — contracts inside the shared UI

`@faultmaven/copilot-ui` is one source built by two hosts (this extension and
the Dashboard). Package boundary and host contract: `docs/HOST_INDEPENDENT_UI.md`.
This file holds the rules that constrain code *inside* the package.

## Requests

- `authenticatedFetch` / `authenticatedFetchWithRetry` (`lib/api/client.ts`).
  On a `401 SESSION_EXPIRED` the retry variant calls `refreshSession()`
  (`lib/api/session-core.ts`), which is **single-flighted** — N parallel failing
  requests trigger one `/sessions` POST — via the Web Locks API with an
  in-context promise fallback, and **persists the new `session_id`** so the
  retried request attaches `X-Session-Id`. Do not call `createSession()`
  directly on this path: it returns a session without persisting it.
- `prepareBody()` (`lib/api/client.ts`) serializes every service body and turns
  `undefined` into `null`. `null` tells the backend "this field is empty"; a
  field absent from the object is truly missing (partial update). Type fields as
  `string | null` to force the choice.
- `submitTurn(caseId, request, { signal })` takes an `AbortSignal`; the
  side-panel hooks abort in-flight turns on unmount. Abort surfaces as a
  non-retryable `AbortError` treated as silent cancellation, not a failed turn.
- 202 polling (`lib/api/services/case-service.ts`, `VITE_POLL_*`):
  `POLL_MAX_TOTAL_MS` is a **wall-clock** budget from the first poll, counting
  request time and sleeps. Never go back to `elapsed += delay`: it counted only
  sleeps, so a stalled poll made the ceiling unbounded.
- `resilientOperation` (`lib/utils/resilient-operation.ts`): non-idempotent
  writes pass `idempotent: false` and are not auto-retried on `network`
  failures (an ambiguous POST may already have committed).

## Errors (`lib/errors/`)

`UserFacingError` subclasses carry `userTitle` / `userMessage` / `userAction`,
`category`, `recovery` and `getDisplayOptions()`. Recovery per class
(`types.ts`): `SessionExpiredError` auto_retry_with_delay · `AuthenticationError`
show_modal · `PermissionError` graceful_degradation · `NetworkError`
retry_with_backoff · `TimeoutError`, `ServerError`, `CaseVersionConflictError`,
`UnknownError` manual_retry · `ValidationError` user_fix_required ·
`QuotaExhaustedError` graceful_degradation · `OptimisticUpdateError`
rollback_and_retry · `RateLimitError` derived (below).

**`RateLimitError` recovery is derived, not fixed.** The protection
middleware's `Retry-After` is measured and uncapped (seconds for a per-minute
bucket, up to 3600s for an hourly one). Within `MAX_AUTO_RETRY_WAIT_MS` (120s,
`types.ts`) recovery is `auto_retry_with_delay` and `resilientOperation` waits
the window out in full; past it, `manual_retry` — the quota provably has not
freed, so an automatic attempt only spends bounded attempts. 120s is derived:
`maxAttempts: 3` gave two waits of at most 60s, so every recovery that used to
happen automatically still does; lowering it hands the user a retry the client
used to perform. **Never clamp the wait and retry anyway** (fm#985 item 9).
`userAction` is a static string rendered once, not a countdown, and a toast
`duration` is a real auto-dismiss timer — never hand it a window length.

`QuotaExhaustedError` is HTTP 402 / `x-error-code: QUOTA_EXHAUSTED` (the AI
provider is out of credits): no auto-retry, no retry button, the user's input is
preserved.

**Reading an error body: always `errorBodyText`** (`lib/errors/error-body.ts`).
The backend answers in two shapes — `{ detail }` from every FastAPI handler, and
`{ error, message, retry_after }` with **no `detail`** from the protection
middleware (429, 409/503 dedup). `errorData.detail || '<fallback>'` silently
discards the server's text on exactly the responses where it says the most
(fm#994); `src/test/lib/errors/error-body.test.ts` fails if a new one appears.
`errorBodyText` returns a string or nothing, never an array — a 422 puts field
errors in `detail`, which `ErrorClassifier.extractFieldErrors` reads. When you
throw from a raw `fetch`, **carry `status` and `retryAfter`** or a 429 becomes an
`UnknownError` and the wait is lost (see `lib/session/client-session-manager.ts`).
On a 429 the chat and toast render `RateLimitError.userMessage`; the server's
diagnostic text goes to the failed-operations banner, `error.message` and logs.

## Optimistic ids (`lib/optimistic/`, `lib/utils/data-integrity.ts`)

Optimistic ids start with `opt_`; real ids never do. The case list is real-only
(`sanitizeBackendCases`, `validateStateIntegrity`): a transient `opt_case_*`
exists only while a lazy case-create is in flight, is set as the active-case id,
and is reconciled to the real id via `idMappingManager`. If the create fails the
optimistic active-case id is rolled back; both submit paths resolve a stale
`opt_case_*` (via the mapping, or a fresh real case) before POSTing a turn. Only
**case** ids are swapped; a message keeps its `opt_msg_*` id until the delta
fetch reconciles it (below). Pending operations carry `retryFn`/`rollbackFn`.

## Transcript rows (`lib/state/message-kind.ts`, `cases-slice.handleCaseSelect`)

`GET /cases/{id}/messages` serves roles `user` / `assistant` / `system`. The
delta mapper maps each row to exactly one slot on `OptimisticConversationItem`
by `messageKind`: `user` → `question` (right bubble), `assistant` → `response`
(left card), everything else → `notice` (full-width quiet row labelled
**System**). **`notice` is the default arm, not an equality test on `'system'`**,
and `messageKind` takes `string` rather than the generated `role` union: a role
added later must never be presented as something a participant said. `system`
is the channel the backend reports background work on (runbook conversion
outcome, `milestone_engine._run_runbook_conversion`); those strings live in the
backend and have been reworded before — cite the function, do not quote them.

Invariants when touching the mapper:

1. **No committed row may render nothing.** `notice` gives every role a slot,
   and a blank-content filter skips empty/whitespace rows (reachable:
   `QueryRequest.query` is `min_length=1`). Accepted cost: `offset` is a local
   row count used as an index into the backend list, so skipping a row leaves
   that case's offset one short and later opens re-read the tail. Since #213
   the re-read reconciles instead of duplicating. Do not add a compensating
   skipped-row counter — it double-counts on the capped-conversation over-read
   and skips a *real* message.
2. **A notice carries `turn_number` but never displays it.** The merge's
   turn-floor guard needs it; the claim is suppressed in `ChatWindow`
   (`formatTimestampWithTurn` is called without the turn).
3. **Two turn counters, not interchangeable** (#251, contract 3.5.0).
   `turn_number` / `current_turn` is the MESSAGE clock and advances on asides;
   `investigation_turn` is investigation progress and is what "Turn N" prints,
   via `displayedTurn` (`lib/state/turn-label.ts`, falls back to the clock for
   a server older than 3.5.0). **The clock is what addresses a turn**: `data-turn`
   and `scrollToTurn` stay on it because they are fed `uploaded_at_turn`; label
   and anchor differ on purpose. Contract 3.7.0 puts `investigation_turn` on
   evidence and file rows themselves; the `turnLabel` resolver threaded
   `ChatWindow` → `EnhancedCaseHeader` → `CaseDetails` → `EvidenceDetailsModal`
   (`investigationTurnFor`) returns `undefined` when the conversation no longer
   holds the row, and those surfaces then print no turn rather than the other
   counter. Adopting `TurnResponse.investigation_turn` onto a submitted row is
   gated on `serverSuppliesInvestigationTurn`.

**Message-id reconciliation** (`lib/state/reconcile-message-ids.ts`, #213): an
incoming backend row matching a local committed row still carrying an `opt_` id
on **turn number AND slot** adopts that row's identity instead of appending a
duplicate; an ambiguous `(turn, slot)` is refused. **Slot matching is
load-bearing** — a notice shares a turn with the exchange it landed during but
never its slot. `useMessageSubmission` takes the backend `turn_number` for the
**user** row too, not a `highestTurn + 1` prediction.

**Cache schema.** `CONVERSATION_CACHE_VERSION` (`lib/state/store.ts`) stamps the
persisted `conversations` map and `useDataRecovery` discards a mismatch
(lossless: committed messages live on the backend; titles, pins and id-mappings
untouched). **Bump it whenever a change alters which backend rows reach the
store** — the offset rule above makes rows dropped by an older build
unreachable for the life of that cache.

**Delivery.** `getCaseConversation` has one call site, `handleCaseSelect`, so a
notice is seen only when the case is re-opened. Live push needs a structured
"background job started" marker on the turn response (none exists; no
SSE/WebSocket). Re-running the delta merge after each turn is unblocked since
#213 but not built.

The Dashboard classifies the same rows in `lib/cases/messageAttribution.ts` —
a parallel copy, not shared code. Change one, look at the other.

## Persistence (`lib/state/store.ts`)

The store persists via a debounced subscribe. Two rules:

1. **Committed conversation data only.** `memoryManager.sanitizeAndCapForPersistence()`
   drops transient items (`optimistic` / `loading` / `failed` / `error`; see
   `isCommittedMessage`) and empty conversations, so a reload never rehydrates a
   stuck spinner or a turn that would duplicate on delta fetch.
2. **`pendingOperations` is never persisted** — its closures cannot survive
   JSON; `pendingOpsManager` is the in-session source of truth.

Growth is bounded by capping the number of conversations and the messages within
each to recent turns. That is safe because `handleCaseSelect` treats the local
committed count as a lower-bound fetch hint (a suffix over-reads harmlessly) and
merges with a **turn-floor + message_id** guard; `capConversationToRecentTurns`
snaps the cut to a turn boundary.

## Case titles

`CreateCaseRequest.title` is `string | null` — `null` makes the backend generate
`Case-MMDD-N`; a string is explicit. Rename is `PUT /api/v1/cases/{id}`;
LLM generation is `POST /api/v1/cases/{id}/title`. What renders is resolved by
`selectCaseTitle` (`lib/state/case-title.ts`): store `conversationTitles[caseId]`
> backend `UserCase.title` > fallback. The store is written synchronously on
rename/generate and rolled back if the PUT fails; every title read goes through
this one selector.

## Case status (`lib/api/services/case-service.ts`)

States: `inquiry`, `investigating`, `resolved` (terminal), `closed` (terminal).
`getValidActions(status)` returns what the status menu may offer; `getValidTransitions`,
`getStatusChangeMessage` and `isTerminalStatus` are deprecated aliases of
`getValidActions`, `getCaseActionMessage` and `isDisposition`.

**Only `closed` is ever selectable** (`inquiry` → `closed`, `investigating` →
`closed`); `investigating` is refused by every backend since fm#1608 and
`resolved` from contract 9.0.0, which this repo pins. The client still gates the
Close control on `disposition_eligibility.closed === 'ready'`, so `needs_info`,
`suggests_alternative` and `not_eligible` all suppress it — on a
resolution-grade case the menu is correctly **empty**. `suggests_alternative` on
the `closed` side means *do not render*: every close there would pivot back to
a resolve proposal.

- `inquiry → investigating` is earned by a confirmed problem statement (Gate 1).
- `investigating → resolved` is earned by a confirmed root-cause elimination;
  the agent offers it through the confirm/decline pair, or the user says so in
  conversation. **Resolving is something the user says, not clicks.**
  `disposition_eligibility.resolved` is FaultMaven's readiness verdict, not an
  affordance.

**Post-terminal card** (`shared/ui/components/ResolutionActionsCard.tsx`) is a
status banner, not navigation: "Case Resolved" with root cause and stats, or
"Case Closed" with the `shortLabel` from `CLOSURE_DISPLAY_INFO` (five reasons
mirroring backend `VALID_CLOSURE_REASONS`; unknown values fall back to `other`).
**No Dashboard link**: closure and resolution summaries are rendered inline in
the chat reply at generation time, so a card linking to the Dashboard's Report
tab for a summary already visible above is noise. Runbooks are user-requested
(the agent offers them as suggestions on terminal Q&A turns).
