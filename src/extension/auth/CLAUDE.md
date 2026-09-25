# src/extension/auth — the credential chain

This directory owns sign-in, token storage, refresh and teardown for the
extension host. The shared UI (`packages/copilot-ui`) never sees a refresh token;
it asks the host for an access token through `HostSession.accessToken()`, which
`src/extension/host/session-credential.ts` answers from here.

## Authentication modes

Auto-detected from `GET /api/v1/auth/config` (`auth-config.ts`, cached; the cache
is cleared when the configured endpoints change).

- **`local`** — username/password against `POST /api/v1/auth/login` /
  `/register` (`local-auth-client.ts`). Refresh is `POST /api/v1/auth/refresh`
  with `{ refresh_token }` → `{ access_token, token_type, expires_in, refresh_token }`
  (rotated; **no** `refresh_expires_in`). `/oauth/token` is **not mounted** in
  local mode — refreshing there 404s and forces a re-login, so never hardcode it.
- **`oauth`** — PKCE via the Dashboard (`dashboard-oauth.ts`). The extension
  calls `identity.launchWebAuthFlow`, which opens the Dashboard's
  `/auth/authorize` page in a browser-owned window and settles **only** on a
  real navigation to the browser-derived redirect URI
  (`https://<id>.chromiumapp.org/` on Chromium, `https://<id>.extensions.allizom.org/`
  on Firefox) — which is why the Dashboard's approve path must navigate rather
  than rewrite the address bar. There is no tab watcher; the browser closes the
  window itself. The code is exchanged at `POST /api/v1/auth/oauth/token`, and
  refresh is the RFC 6749 refresh grant on the same endpoint (includes
  `refresh_expires_in`). `state` is still verified against the value this flow
  minted: `launchWebAuthFlow` proves the redirect reached *this* extension, not
  which request produced it.
- **Dashboard-bridge sessions** (`background.ts` `handleStoreAuth`, fed by
  `auth-bridge.content.ts`) persist every TokenManager key — including
  `refresh_token` — from the Dashboard's `fm_auth_state` payload, not just the
  composite `authState`; otherwise a bridge session has no refresh material and
  silently logs out at access-token expiry.

`TokenManager.performRefreshOnce` picks the refresh endpoint from the cached
auth config. `refresh_expires_in` is OAuth-only, so it is not part of the
well-formed-payload check; when absent, `refresh_expires_at` is removed (an
undefined refresh window means "refresh until the backend definitively rejects").

Cloud admits the OAuth redirect of the **published** extension id only. An
unpacked build takes an id derived from its directory, so it cannot sign in to
Cloud unless built with `FM_STORE_KEY` (`wxt.config.ts` `storeIdentity`).

## Storage keys

`storage-keys.ts` holds `AUTH_STATE_KEY` (`authState`, the composite identity
row), `CREDENTIAL_KEYS` (every credential key) and `isUsableTimestamp`. All three
credential writers — `handleStoreAuth`, the OAuth exchange, `LocalAuthClient.storeTokens`
— write through those lists and **omit** an unusable expiry rather than storing a
sentinel: one encoding of "unknown" (an absent key), with `AuthState.expires_at`
optional to match. A key a response cannot supply is **removed**, never left to
be inherited from the previous session (`storage.set` drops an undefined value
instead of clearing). A key added to the writers and forgotten in the teardown
stays at rest after a "full" logout — a partial teardown no test sees.

`subscribeExtensionAuthState` watches `authState` **alone**: its disappearance is
the sign-out. Clearing credential keys without it ends a session unobservably.

## Auth teardown — who DECIDES, who REPORTS, who ENDS

**One verdict.** `TokenManager.assess()` is the only code that rules on a
credential — applies `USABLE_TOKEN_MARGIN_MS`, rules on a missing expiry, weighs
refreshability — and it writes nothing. It returns `absent` / `usable` /
`refreshable` / `dead`; `getValidAccessToken` acts on it and `isAuthenticated`
reduces it to a boolean, so there is no second opinion. The order inside it
matters — refreshability is decided before an unmeasurable expiry is ruled on:

- Unmeasurable expiry + a refresh token → `refreshable`. The refresh writes a
  real `expires_at` and the state heals. Calling it `usable` means no refresh is
  ever attempted and the backend's 401 (with a bearer) becomes the *hard*
  teardown, destroying a refresh token that would have renewed the session.
- Unmeasurable expiry, nothing to refresh with → `usable`. The backend can rule
  and a 401 converges; calling it dead destroys a session that may be fine.
- A closed refresh window is **not** death. It only stops a proactive refresh;
  once the access token's life is spent, a refresh token we still hold is
  presented anyway and the backend rules. Deciding locally turned a window that
  lapsed while the backend was merely *down* into a `dead` on every later read.
  **`dead` means only: nothing to present, and nothing to present it with.**

**TokenManager reports; it never ends a session.** `getValidAccessToken()`
answers a token, or `null` meaning *nothing usable right now* (transient — a
header-less request whose 401 routes to the recoverable path; a later call
retries), or throws `SessionEndedError` (`session-ended-error.ts`), which extends
the package's `AuthenticationError`. That inheritance is the contract:
`getAuthHeaders` swallows every other throw into a header-less request and
propagates this one, so a dead session never becomes a doomed `POST /sessions`
plus "session expired, retrying" — the request is not sent and the caller gets
an error whose recovery is a sign-in prompt. A host that throws anything else
keeps the old behaviour (the Dashboard host is unaffected).

**`readSessionAccessToken()` (`../host/session-credential.ts`) is the one place
that acts**, catching `SessionEndedError` and calling `clearAllAuthData()`. It is
a module rather than inline in `ExtensionApp` because two test harnesses model
this contract and inline copies drifted; all three import the same function.
`getValidAccessToken` has exactly two callers — the act-site, and `logoutAuth`,
which deliberately **swallows** the verdict so its own POST can never tear the
session down. `background.ts` uses `fetchWithTimeout` directly and has no path
to cover.

**A transient outage never ends a session.** The refresh ladder can burn ~48s,
enough to carry a short refresh window past its end; a `dead` reached only
because the clock moved while the backend was down returns `null` (tokens
preserved) rather than throwing. Revocation arrives as `SessionEndedError` from
the attempt itself.

**Compare-and-swap on `refresh_token` before acting on any refresh verdict**, on
the rejection path *and* the success path: a sign-in landing mid-refresh rotates
the chain, and the success path would otherwise stamp the pre-flight snapshot's
`session_id` / `user` / `authState.user` over storage the new sign-in just
re-seeded. The sign-in side holds no lock (`handleStoreAuth`, the OAuth exchange
and `storeTokens` write storage directly), so the rotation is a single `set()`
and a sign-in cannot interleave between the credential keys and `authState`.

**Reads never destroy.** `getAuthState()` / `isAuthenticated()` /
`getCurrentUser()` answer a question and nothing else. Repair is
`authManager.reconcileSession()`, explicit and run once at panel startup: it
clears a row with no live credential behind it and a row with no `user`
(copilot#185). It asks `tokenManager.isAuthenticated()` **directly**, not through
`getAuthState()`, which folds "the read threw" into the same `null` as "no live
session" — reconciling on that conflation turns a transient storage error into an
irreversible sign-out. It returns the state it validated; `userFromAuthState()`
maps it so startup reads storage once.

### The three clearing functions

- `authManager.clearAllAuthData()` — **the teardown**: `authState` + case cache
  + every credential key, both halves even if the first throws. Callers:
  `logoutAuth()`, `ExtensionApp`'s `onUnauthorized` (what `client.ts
  handleAuthError()` delegates a hard 401 to), options `handleSignOut()`,
  `LocalAuthClient.signOut()`, `reconcileSession()`, and the act-site.
  It **single-flights and never rejects** — both are contracts. The act-site and
  `onUnauthorized` fire once per failing request, so a revoked credential would
  otherwise mean three teardowns and three sign-out notifications; and every
  caller does something load-bearing immediately afterwards (`logoutAuth` and
  `LocalAuthClient.signOut` broadcast `auth_state_changed`; `onUnauthorized` must
  return an `AuthOutcome` because `client.ts` awaits it unguarded and turns
  anything else into an `UnknownError`, so the sign-in prompt never appears).
- `authManager.clearAuthState()` — the **identity half**; one legitimate
  caller, `clearAllAuthData()`. Alone it leaves a live Bearer that TokenManager
  re-mints from. Treat as private.
- `tokenManager.clearTokens()` — credential keys only, **not** a teardown.

What `clearAllAuthData()` does **not** cover: persisted conversations, titles,
pinned cases and the resumable client id are purged by
`auth-slice.signOutLocally()` in the package, which needs a **mounted panel** to
observe the `authState` change.

### Logout

`logoutAuth` (`auth-service.ts`) does not use `authenticatedFetch`. It asks
`getValidAccessToken()` directly, swallows the verdict, falls back to
`peekAccessToken()`, and POSTs `/api/v1/auth/logout` by hand. Going through
`getAuthHeaders` would let a near-expiry proactive refresh's verdict reach the
act-site and tear the session down *mid-logout*, before the broadcast. Both
halves matter: a healthy near-expiry session refreshes so the account-wide
revocation is actually written, and a dead chain tears nothing down.

Order in the `finally`: read the refresh token → `clearAllAuthData()` →
**broadcast** → revoke, and the revoke is **not awaited**. `ExtensionApp.signOut`
awaits `logoutAuth`, so awaiting a ~20s best-effort network call there stalls
the panel; and the teardown must never sit behind it, or a panel closed
mid-revoke leaves a "signed out" user holding live tokens at rest.

`POST /api/v1/auth/logout` revokes the **access** token. The **refresh** token is
revoked separately, in OAuth mode only, by a best-effort
`POST /api/v1/auth/oauth/revoke` (`token_type_hint: refresh_token`, RFC 7009),
skipped in local mode where it is not mounted. That call is **handed to the
background worker** (`revoke-refresh-token.ts`): an un-awaited fetch belongs to
the document that started it, and a user who signs out and closes the panel
would take it with them. `runtime.sendMessage` reaches extension pages and the
worker, never a content script, and the worker's `sender.id` gate is what makes
carrying the token in a payload safe. The hand-off **falls back to calling
in-context** when no worker takes the message (evicted, a test environment, or
`logoutAuth` called from the worker itself, where Chrome does not deliver a
message to the sender's own listener).
