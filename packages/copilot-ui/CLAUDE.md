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
  failures (an ambiguous POST may already have committed). `deadlineMs` is a
  wall-clock bound counting in-request time (the `POLL_MAX_TOTAL_MS` rule); a
  `retryOptions.shouldRetry` override replaces the default decision, so one
  that adds cases calls `defaultRetryDecision` for the rest.
- **Keyed turns** (`lib/utils/keyed-turn-retry.ts`, contract 12.2.0). Both turn
  paths send `Idempotency-Key = idempotencyKeyFor(aiMessageId)` and pass
  `keyedTurnRetryPolicy()`: a client `TimeoutError` or an UNCODED (gateway) 504
  is retried with the same key under `timing.deadlineMs`. A coded 504 is
  the API's own answer that nothing committed (and `isAmbiguousFailure` is
  false for it): `REQUEST_TIMEOUT` is NEVER retried automatically (the same
  input likely exhausts the ceiling again at full LLM cost; the user's manual
  Retry stays), `LLM_TIMEOUT` is retried once after its `Retry-After`. A 409
  `TURN_IN_PROGRESS` is polled every min(`Retry-After`, 5 s) (the header is an
  upper bound on the claim; `maxDelay` keeps the backoff from outgrowing it); a
  504 with an unknown code and everything else keep their default decision and
  attempt count. The retry replays a committed turn (200,
  `X-Idempotency-Replayed`), so it is reconciled like a first answer. The
  timings are derived, not policy (contract 12.4.0, `lib/utils/turn-timing.ts`):
  request timeout = `limits.turnResponseBoundSeconds` (from `/meta/capabilities`;
  accepted only within 30-1200 s) + 60 s network margin + an upload allowance of
  ceil(body bytes / 125 000) s (1 Mbps; the server binds its deadline after
  reading the body); recovery deadline = 2 x that. Capabilities are re-read
  before a turn when the network read held is older than 5 minutes
  (`refreshIfStale`; a failed re-read keeps the earlier read). With no usable
  bound the old constants apply (300 s / 660 s, plus the same allowance) and a
  warning is logged once per capabilities object. The deadline bounds the START
  of a retry, so the worst case is about deadline + one request timeout.
  After `IDEMPOTENCY_KEY_REUSE` the manual Retry is a new logical turn and goes
  out under a fresh key (`rotateIdempotencyKey`).

## Errors (`lib/errors/`)

`UserFacingError` subclasses carry `userTitle` / `userMessage` / `userAction`,
`category`, `recovery` and `getDisplayOptions()`. Recovery per class
(`types.ts`): `SessionExpiredError` auto_retry_with_delay · `AuthenticationError`
show_modal · `PermissionError` graceful_degradation · `NetworkError`
retry_with_backoff · `TimeoutError`, `ServerError`, `CaseVersionConflictError`,
`UnknownError` manual_retry · `ValidationError` user_fix_required ·
`QuotaExhaustedError`, `TurnReplayUnavailableError`, `CaseTerminalError` graceful_degradation ·
`IdempotencyKeyReuseError` manual_retry (under a fresh key) ·
`TurnInProgressError` auto_retry_with_delay ·
`OptimisticUpdateError` rollback_and_retry · `RateLimitError` derived (below).

**A 409 is told apart by `x-error-code`** (contracts 12.2.0, 12.3.0): `TURN_IN_PROGRESS`
→ `TurnInProgressError` (`Retry-After` clamped to [1, 60] s, 2 s when absent);
`IDEMPOTENCY_KEY_REUSE` → `IdempotencyKeyReuseError` (a client defect, never
auto-retried; the manual Retry rotates the key); `IDEMPOTENCY_REPLAY_UNAVAILABLE`
→ `TurnReplayUnavailableError` (the turn committed: the bubble says it was
saved, and `reloadCommittedTurn` reads it back, dropping the local pair only in
the write that merges the read, so a failed read loses nothing); `CASE_TERMINAL`, on
any route → `CaseTerminalError` (the case is resolved or closed: never retried,
no Retry anywhere. Both turn hooks remove the pending op instead of failing it,
put the reason in the bubble, naming any attachments that were not added and saying they are still in the
message box (the turn result carries `refused`, so the composer keeps the refused
text and attachments instead of clearing), and
call `refreshActiveCase` so the panel shows the case closed; the title rename
(`titleChangeDeps`, `lib/state/case-title-deps.ts`) rolls back, shows it, reads
the case back and refetches the list. Only `CaseTerminalError` is passed through
there: every other rename failure keeps its old toast. A text-only question on a
closed case is still answered, so it never meets this); `CASE_VERSION_CONFLICT`
and an unlabelled 409 → `CaseVersionConflictError`. This client never calls
`POST /cases/{id}/close`: closing is a `status_transition` turn.
`authenticatedFetch` carries `retryAfter` (seconds) on every non-OK, and
`resilientOperation` waits out any error implementing `ServerDirectedWait`
(`hasServerDirectedWait`), not one class.

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

`DuplicateUploadNotice` is not a failure: category `notice`, recovery `none`,
an `info` toast that dismisses itself, is announced politely (`role="status"`),
gives way first when the toasts are full, and is logged at info, never error.
The upload hook shows it for uploads whose content the case already held
(`AttachmentResult.duplicate_of`). `duplicateUploads` (`lib/state/turn-items.ts`)
recognises the one match that is not that: a second copy within one submission
names a sibling's new `file_id`. A RESENT turn is not an exception: a file is
committed only with the turn that carried it, so a retry is a fresh upload and a
match on it is real (and the only signal that a file landed when a turn
committed but the client showed an error). A failed turn that carried
attachments names them (`unsentAttachmentsNotice`, `lib/state/unsent-attachments.ts`,
used by the failed-operation banner and the failed assistant bubble): they were
not added to the case, and Retry sends them again ("may not have been added" when no HTTP response arrived, or a 409 TURN_IN_PROGRESS outlasted the deadline, since the turn may have committed: `isAmbiguousFailure`). A match whose `duplicate_turn` equals the response's `turn_number` is an older server reporting the failed attempt, and is skipped. The text says what
matched by content, never that the original had the same name, and says
"nothing new" only of what matched. `duplicate_turn` is the message clock, so
the turn is printed through `investigationTurnFor` over COMMITTED rows, and left
out when none labels it.

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
fetch reconciles it (below), or until its turn's response finds the server's
copy already merged (`applyTurnResponse`, below). Pending operations carry `retryFn`/`rollbackFn`.

## Transcript rows (`lib/state/message-kind.ts`, `cases-slice.handleCaseSelect`)

`GET /cases/{id}/messages` serves roles `user` / `assistant` / `system`. The
delta mapper maps each row to exactly one slot on `OptimisticConversationItem`
by `messageKind`: `user` → `question` (right bubble), `assistant` → `response`
(left card), everything else → `notice` (full-width quiet row labelled
**System**). **`notice` is the default arm, not an equality test on `'system'`**,
and `messageKind` takes `string` rather than the generated `role` union: a role
added later must never be presented as something a participant said. `system`
is the channel the backend reports background work on (runbook conversion
outcome, `RunbookCreator._run_runbook_conversion` in
`milestone_engine/runbook_creation.py`); those strings live in the backend and
have been reworded before — cite the function, do not quote them.

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
   and anchor differ on purpose. Evidence and file surfaces name a turn they do
   not render, so they take a `turnLabel` resolver threaded `ChatWindow` →
   `EnhancedCaseHeader` → `CaseDetails` → `EvidenceDetailsModal`, backed by
   `investigationTurnFor`. **That threading is superseded by contract 3.7.0**
   (faultmaven#1391), which puts `investigation_turn` on the evidence and file
   rows themselves; the resolver returns `undefined` once the conversation is
   trimmed past the row, where the served field always answers. It stays only
   until those surfaces read the field (and for rows from a server below
   3.7.0). On `undefined` they print no turn rather than the other counter.
   Adopting `TurnResponse.investigation_turn` onto a submitted row is gated on
   `serverSuppliesInvestigationTurn`.

**Message-id reconciliation** (`lib/state/reconcile-message-ids.ts`, #213): an
incoming backend row matching a local committed row still carrying an `opt_` id
on **turn number AND slot** adopts that row's identity instead of appending a
duplicate; an ambiguous `(turn, slot)` is refused. **Slot matching is
load-bearing** — a notice shares a turn with the exchange it landed during but
never its slot. A committed turn takes the backend `turn_number` for the
**user** row too, not a `highestTurn + 1` prediction.

**Committing a turn** (`lib/state/turn-items.ts`, #305). Both turn paths
(`useMessageSubmission`, `useDataUpload`) turn a `TurnResponse` into rows
through `applyTurnResponse` and nothing else. The rows are typed, never cast
(`as OptimisticConversationItem` is what let `sources` reach neither path until
#298); `src/test/lib/state/turn-items.test.ts` fails if a hook grows its own
mapping. `suggestionFromResponse` narrows each suggestion: a `type` this build
does not know becomes `UNRECOGNIZED` (plain text, never clickable). A
suggestion's `intent` is kept **whole** and sent back verbatim on click: core
routes on keys and intent types this client does not declare (an offer key,
`file_reclassification`'s `file_id`), so it is never rebuilt from known fields
or checked against `IntentType`.

**Cache schema.** `CONVERSATION_CACHE_VERSION` (`lib/state/store.ts`) stamps the
persisted `conversations` map and `useDataRecovery` discards a mismatch
(lossless: committed messages live on the backend; titles, pins and id-mappings
untouched). **Bump it whenever a change alters which backend rows reach the
store, or which fields a row read from the backend carries** — the offset rule
above makes rows dropped by an older build unreachable for the life of that
cache, and the delta fetch never re-reads a cached row for a new field (v4
`investigation_turn`, v5 `sources`).

**A copy merged while the turn was in flight** (faultmaven#1888). The
reconciliation skips in-flight rows, so a delta fetch during a keyed turn's wait
(panel reopened, case switched back) appends the server's copy beside the
loading pair. `applyTurnResponse` drops that copy and gives the pair its
identity, matching on the RESPONSE's `turn_number` (never the prediction) and
slot. Two guards: a row present when the turn was first sent
(`TurnRowIds.presentAtSend`) is never the copy, and both slots must have exactly
one candidate (a turn commits atomically, #1882), or nothing changes.
`POST /cases` with an `initial_message` stamps that row turn 1 while
`current_turn` stays 0, so the first turn also commits as turn 1.

**Delivery.** `getCaseConversation` has one call site, `fetchConversationDelta`
(called by `handleCaseSelect`, and by `reloadCommittedTurn` after
`IDEMPOTENCY_REPLAY_UNAVAILABLE`), so a notice is seen only when the case is
re-opened. It resolves whether its merge landed; a call that replaces rows
chains a fresh fetch after one in flight instead of skipping (the one in flight
may predate the commit). Live push needs a structured
"background job started" marker on the turn response (none exists; no
SSE/WebSocket). Re-running the delta merge after each turn has been unblocked
since #213 but is not built.

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
the placeholder `Case-YYMMDD-N` (`isPlaceholderCaseTitle` also accepts the
older `Case-MMDD-N` form); a string is explicit. Rename is
`PUT /api/v1/cases/{id}`; LLM generation is `POST /api/v1/cases/{id}/title`.
What renders is resolved by `selectCaseTitle` (`lib/state/case-title.ts`):
store `conversationTitles[caseId]` **unless it is a placeholder** > backend
`UserCase.title` > fallback. A placeholder in the store yields to the backend
because older builds seeded the store with whatever the backend last reported,
pinning the placeholder ahead of the real title written later (fm#1069). The
store is written synchronously on rename/generate and rolled back if the PUT
fails; every title read goes through this one selector.

## Case status (`lib/api/services/case-service.ts`)

States: `inquiry`, `investigating`, `resolved` (terminal), `closed` (terminal).
`getValidActions(status)` returns what the status menu may offer; `getValidTransitions`,
`getStatusChangeMessage` and `isTerminalStatus` are deprecated aliases of
`getValidActions`, `getCaseActionMessage` and `isDisposition`.

**Only `closed` is ever selectable** (`inquiry` → `closed`, `investigating` →
`closed`); `investigating` is refused by every backend since fm#1608 and
`resolved` since contract 9.0.0. The client still gates the
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
"Case Closed" with the `shortLabel` from `CLOSURE_DISPLAY_INFO` (one entry per
backend `VALID_CLOSURE_REASONS` value, plus an `other` fallback every consumer
uses for a reason this build does not know).
**No Dashboard link**: closure and resolution summaries are rendered inline in
the chat reply at generation time, so a card linking to the Dashboard's Report
tab for a summary already visible above is noise. Runbooks are user-requested
(the agent offers them as suggestions on terminal Q&A turns).

## The case driver (ADR-020, faultmaven#1898)

A case has a **creator** (`user_id` on the wire, `UserCase.owner_id`) and one
**driver** (`UserCase.driver_id`, always the EFFECTIVE driver on a served row).
Every reader views a case; only the driver writes it (turns, uploads, title,
close, reports); delete is the creator's.

- **The sidebar lists the cases its user drives**: `ConversationsList` asks for
  `SIDEBAR_CASE_LIST_QUERY` (`access=write`, first page). The filter is that
  query's, never `getUserCases`' default: `reconcileActiveCaseState` runs in
  both hosts and must find the open case among every case the user can READ.
- **The single-slot list cache holds that one query.** `getUserCases`'
  `isSidebarList` reads the issued URL and admits only `access=write` + the
  default page, so reconcile's unfiltered read neither fills the slot nor is
  served from it. Changing the query or the cached row shape bumps
  `CASE_CACHE_VERSION` (`lib/cache/case-cache.ts`).
- **Rows**: no "Shared" mark (every row is drivable); rename and title
  generation unless a (stale) row names another driver; delete only where
  `isCreatedBy(row, viewer)`.
- **Read-only open case** (`lib/cases/driver.ts`): the extension host passes
  `readOnly={isDrivenByOther(activeCase, currentUser.id)}`; unknown (a
  placeholder, a locally minted case) is writable. A case can be reassigned
  away while open, and a restored last case arrives with no row, so the 403
  backstop stays: `lib/state/write-refused.ts` reads the refused case back, and
  if another account drives it marks it denied, drops the list cache slot and
  reloads the list (the case leaves the sidebar). A fresh row naming the viewer
  as driver retires the denial (handed back). The Dashboard host passes its own
  `initialCase.readOnly` and never mounts the sidebar.
- **Redacted sources** (contract 13.1.0): a `knowledge_base` source with
  `metadata.access === 'restricted'` (`isRestrictedSource`,
  `lib/state/turn-sources.ts`) is a runbook this viewer may not open; it renders
  as "A runbook you don't have access to" — no "Source N", link, preview or
  score — and still counts toward "N runbooks in context".
