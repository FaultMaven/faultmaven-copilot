# Host-independent Copilot UI

The Copilot UI runs in the extension side panel. The Dashboard renders case
transcripts but cannot continue an investigation, so installing an extension is
the price of using FaultMaven interactively at all. This document proposes how
one UI comes to run in both hosts.

## The invariant

There is exactly one source of the Copilot UI. Both hosts build from it at a
pinned, immutable revision, and neither host contains a copied or forked
component of it. A change to the UI reaches both hosts through that one source
or reaches neither.

The failure to design against is not breakage. It is a fix that lands in one
host and not the other with nothing red.

That failure is not hypothetical here. Four copies exist across the two repos
today, and one of them has already drifted unnoticed:

| Copy | State |
|---|---|
| `src/lib/identity.ts` | Byte-identical in both repos. Held together only by two test files asserting the same literal colours. |
| `src/types/api.generated.ts` | Byte-identical. Held together by each repo independently regenerating from the same pinned contract. |
| `messageKind` / `MessageKind` | Two files, two names — `copilot: src/lib/state/message-kind.ts`, `dashboard: src/lib/cases/messageAttribution.ts`. Same three-way mapping, no gate comparing them. |
| `src/types/case.ts` | **Already diverged.** The Dashboard's copy is missing the `CaseDetail`, `Message` and `UserCaseState` re-exports the Copilot's has, and has **zero importers** in the Dashboard. It was copied, it rotted, nothing turned red. |

## What the boundary actually is

The issue lists the browser APIs `src/shared/ui` reaches for. Verified against
`origin/main` (4b9bab4), the list is right with two corrections, and it
understates the boundary by about a factor of five.

### Direct call sites — 27 references, 9 files

`grep -rn "browser\.\|chrome\." src/shared/ui` returns 28 lines. One of them,
`usePageContent.ts:70`, is the string literal `'chrome.google.com'` in the
extension-gallery check — not a call site. The remaining 27:

| File | Lines | API |
|---|---|---|
| `components/AuthScreen.tsx` | 104, 106 | `runtime.onMessage` add/removeListener |
| `components/AuthScreen.tsx` | 118 | `runtime.sendMessage({action:'initiateOIDCLogin'})` |
| `components/WelcomeScreen.tsx` | 23, 53 | `storage.local.set` |
| `components/WelcomeScreen.tsx` | 34 | `permissions.request` |
| `components/WelcomeScreen.tsx` | 57 | `runtime.openOptionsPage` |
| `hooks/useConfiguredEndpoint.ts` | 39, 42 | `storage.onChanged` add/removeListener |
| `hooks/useDataRecovery.ts` | 114, 136, 207 | `storage.local` get / remove / get |
| `hooks/useDataUpload.ts` | 333 | `storage.local.set` |
| `hooks/useMessageSubmission.ts` | 182, 464 | `storage.local.set` |
| `hooks/usePageContent.ts` | 16 | `tabs.query` |
| `hooks/usePageContent.ts` | 102, 105 | `permissions.contains` / `permissions.request` |
| `hooks/usePageContent.ts` | 115 | `scripting.executeScript` |
| `layouts/CollapsibleNavigation.tsx` | 185, 186, 323, 324 | `runtime.openOptionsPage`, behind `typeof browser !== 'undefined'` |
| `SidePanelApp.tsx` | 260 | `runtime.openOptionsPage` |
| `SidePanelApp.tsx` | 313, 322, 324 | `tabs.query` / `tabs.update` / `tabs.create` |

**Correction 1.** The issue's list omits `permissions.contains` and
`permissions.request` — three sites in two files. Page capture asks for the
tab's origin at runtime because `activeTab` never activates from a side-panel
button, and first-run self-hosted setup asks for `http://localhost/*`.

**Correction 2.** `usePageContent.ts:70` is a string, not a call.

### The transitive closure — 106 more references, 22 modules

`src/shared/ui` is not closed under its own imports. Resolving every import from
its 58 files reaches 64 more modules, and those contain 106 further `browser.*`
references:

```
14  src/lib/utils/persistence-manager.ts     8  src/lib/auth/token-manager.ts
11  src/lib/auth/local-auth-client.ts        7  src/config.ts
 8  src/lib/auth/auth-config.ts              7  src/lib/session/client-session-manager.ts
 6  src/lib/auth/auth-manager.ts             6  src/lib/auth/user-scope.ts
 5  src/lib/state/slices/session-slice.ts    4  src/lib/api/session-core.ts
 4  src/lib/capabilities.ts                  3  src/lib/api/client.ts
 3  src/lib/cache/case-cache.ts              3  src/lib/state/store.ts
 3  src/lib/state/slices/{app,auth}-slice.ts 3  src/lib/utils/messaging.ts
 2  src/lib/api/fetch-utils.ts               2  src/lib/api/services/auth-service.ts
 2  src/lib/state/slices/cases-slice.ts      1  src/lib/state/session-epoch.ts
 1  src/lib/utils/memory-manager.ts
```

So the shared unit is not `src/shared/ui`. It is `src/shared/ui` plus roughly
22 modules of `src/lib`, `src/config.ts` and `src/types` — and that lib half
contains a complete second authentication stack and API client, which is
exactly what must **not** ship into a Dashboard that already has its own. That
constraint shapes everything below.

## a. Where the single source lives, and how the Dashboard pins it

The unit is a package: `packages/copilot-ui/`, created by **moving** the
closure, with the browser-coupled parts replaced by the adapter in section (b)
and the credential-owning parts removed entirely (section f, risks 1 and 2).

Three ways for the Dashboard to consume it.

### Option A — a package published from this repo

`@faultmaven/copilot-ui`, versioned, published to npm or GitHub Packages, pinned
in the Dashboard's `package.json` and lockfile.

- **Immutability:** strongest. A published version cannot be republished.
- **Staleness:** solved by machinery that already runs — Dependabot opens the
  bump PR when a new version appears.
- **Compile cost for the consumer:** lowest. The Dashboard consumes built JS and
  `.d.ts`; its `tsc` and ESLint never walk 12K lines of foreign TSX.
- **Cost:** the organisation publishes no npm packages today, so this is a
  registry scope, a release workflow, a provenance story and a version policy
  built from nothing.
- **Cost:** two PRs and a release for every UI change — publish here, bump
  there. During the panel build-out that latency is paid constantly.
- **Cost:** Tailwind. A prebuilt package either ships compiled CSS (theme frozen
  at publish time; the Dashboard cannot re-theme) or ships class names and
  requires the Dashboard's Tailwind `content` glob to cover `node_modules` — and
  when that glob is wrong the classes are simply purged. Nothing throws. See
  risk 4.

### Option B — a git dependency pinned by SHA, with a subpath

```jsonc
// faultmaven-dashboard/package.json
"@faultmaven/copilot-ui": "github:FaultMaven/faultmaven-copilot#<40-char-sha>&path:/packages/copilot-ui"
```

- **Immutability:** a SHA is a SHA. Both repos are public, so no install-time
  token is needed in either CI.
- **Caveat:** the `#<sha>&path:/…` subdirectory form is pnpm-specific. Confirm it
  against the pnpm version both repos pin (9 in CI) before PR 8; if it does not
  hold, the fallback is a repo-root `exports` entry rather than a subpath.
- **Idiom:** this is the pin both repos already run. `api-contract.pin.json`
  names `FaultMaven/faultmaven` at a SHA, and adoption is a PR here that moves
  `ref`. Reviewers already know the shape, and the same reasoning applies —
  the producing repo publishes by merging, and nothing reaches the consumer
  until the consumer says so.
- **Latency:** one PR per adoption. No version-bump ceremony.
- **Cost:** Dependabot does not bump git SHAs. Staleness needs a purpose-built
  gate (below), which Option A gets nearly for free.
- **Cost:** `pnpm install --frozen-lockfile` in the Dashboard's CI now needs
  git, and runs the package's `prepare` build on install.
- **Cost:** the same Tailwind trap as A.

### Option C — the Dashboard moves into this repo as a workspace

- **This is the only option under which silent divergence is impossible rather
  than merely detectable.** One commit changes the UI and both hosts. There is
  no pin to go stale, so there is no gate to get wrong.
- It also retires all four existing copies in one move rather than leaving them.
- **Cost:** the Dashboard's release train moves. It ships a GHCR image
  (`ghcr.io/faultmaven/faultmaven-dashboard`) built by its own `publish-docker.yml`,
  smoke-tested in a container, scanned by Trivy, and gated by `check-sso-error-slugs`
  and a coverage ratchet. This repo's tags mean the extension (`release.yml`
  asserts the tag equals `package.json`'s version). Two release trains in one
  tag namespace needs a scheme.
- **Cost:** CI cross-talk. Without path filters, every Dashboard PR runs
  `pnpm zip` twice and `extension:digest`. With path filters, a skipped required
  check reports success — a required gate that can be skipped is a gate that can
  fail open, so the filtering has to be done as job-level `if` with an explicit
  neutral result, not `paths:` on the workflow.
- **Cost:** a workspace changes pnpm's hoisting, which can change what the
  extension bundles. Expect one digest change unrelated to any source edit.

### The thing none of the three gives you

A pin makes the consumer **stable**. It does not make it **current**. Under A or
B the Dashboard can sit six months behind and every check stays green — which is
the issue's failure direction wearing a pin.

So whichever option is chosen, the proposal includes a **staleness gate** in the
Dashboard, and it is the part of this proposal that carries the invariant:

> A required check reads the pinned revision, resolves the producing repo's
> `main`, and fails when the `packages/copilot-ui` subtree differs — naming the
> commits. Adoption is moving the pin; refusing to adopt is an explicit,
> reviewed act, not silence.

It must be verified in its own failure state before it is trusted: point the pin
at the previous commit and confirm the check goes red.

### Recommendation

**Option B, plus the staleness gate**, with the theme moved into the package as
a Tailwind preset (below).

Two reasons:

1. **It reuses a pin-and-gate idiom both repos already run.** `api-contract.pin.json`
   plus regenerate-and-diff is the same shape: the producer publishes by merging,
   the consumer adopts by moving a ref, and a required check makes the gap
   visible. That is machinery whose failure modes are already understood here,
   rather than a publishing pipeline the organisation has never operated.
2. **It costs no publishing infrastructure and no per-change version bump**,
   which matters because during the panel build-out the shared UI changes on
   most PRs. It also lets the Dashboard compile the UI from source, so the theme
   can stay one system (a shared preset) instead of a stylesheet frozen at
   publish time.

**But B does not make divergence impossible — only C does.** If the architect's
tolerance is "impossible", the answer is C and the price is moving the
Dashboard's release train. That is decision D1.

### Tailwind, in every option

`packages/copilot-ui/tailwind-preset.cjs` ships the `fm-*` tokens, and **both**
repos' `tailwind.config.cjs` consume it via `presets: [...]`. Today the two
configs are hand-maintained near-copies and have already drifted (risk 4). A
preset makes a missing token a resolution error in one place rather than a
silently unstyled element in one host.

### Chrome Web Store implications

CI hashes the built artifact (`scripts/extension-digest.mjs`) and fails when it
changes without the baseline moving in the same PR. Two signals matter
differently:

- **`package`** — "must ship as a new version before release". The migration
  PRs below change this repeatedly. That is not repeated store uploads: the
  guard *tracks* artifact changes, it does not force a submission per PR. One
  release at the end of the sequence uploads them all.
- **`manifestSurface`** — permissions, hosts, CSP. Store review compares these
  against the listing's justification text, so a change here needs the
  **listing** updated too. **Nothing in this proposal touches it.** No permission
  is added or removed; page capture keeps using `tabs` + `scripting` +
  `optional_host_permissions` exactly as today. The web host adds no manifest
  surface because it is not an extension.

Measured on this branch: adding the adapter contract, the whole playground, and
the config changes leaves the artifact **byte-identical** —
`Extension artifact unchanged (d444c72623fb, 127 files, v1.0.3)`. A design spike
costs no resubmission.

The one PR to watch is the relocation (PR 7): moving files changes chunk names
and therefore the package digest, while changing no behaviour. Land it alone so
the diff that the baseline records is a pure move.

## b. The host adapter

Declared in `src/shared/host/adapter.ts` on this branch, with the reasoning
inline. The interface:

```ts
export interface HostAdapter {
  readonly kind: 'extension' | 'web';
  readonly store: HostStore;
  readonly endpoints: HostEndpoints;
  readonly navigation: HostNavigation;
  readonly session: HostSession;         // non-nullable — see Auth
  readonly pageCapture: HostPageCapture; // a union, not an optional method
}

export interface HostStore {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  subscribe(keys: string[], onChange: (changed: Record<string, unknown>) => void): () => void;
}

export interface HostEndpoints {
  apiUrl(): Promise<string>;
  dashboardUrl(): Promise<string>;
  subscribe(onChange: () => void): () => void;
}

export interface HostNavigation {
  dashboard(path: string): Promise<void>;
  external(url: string): Promise<void>;
  settings: (() => Promise<void>) | null;   // null ⇒ render no settings affordance
}

export interface HostSession {
  user: { id: string; username: string; displayName?: string; email?: string;
          roles: string[]; organizationId?: string };
  accessToken(): Promise<string>;           // the HOST refreshes; the UI never holds a refresh token
  signOut: (() => Promise<void>) | null;    // null ⇒ the host owns sign-out
}

export type HostPageCapture =
  | { supported: true;  capture(): Promise<{ content: string; url: string }> }
  | { supported: false; reason: string; installUrl: string };
```

Two rules the current call sites break, and which the shape enforces:

- **Nothing is optional-by-undefined.** A capability a host lacks is a union
  arm carrying a reason the UI can render, not a missing method the UI probes
  for. `typeof browser !== 'undefined'` (CollapsibleNavigation 185, 323) is a
  guard that does nothing precisely in the host that needs the affordance.
- **`kind` is for copy and telemetry, never for behaviour.** A branch on `kind`
  is a capability this interface failed to model, and the next host makes it
  wrong.

`HostAdapter` above is the target. What the React context is actually typed on
is `WiredHost` — the subset of members that have a call site today, widening by
one member per migration step (`store`, then `navigation`, and so on). The
reason is not caution but evidence: a member nobody has converted cannot be
read, so no host is obliged to implement one that nothing exercises, and no
reviewer is asked to take "it works" on trust for code with no caller. It
extends inside a member too — `navigation` is wired as
`Pick<HostNavigation, 'dashboard' | 'settings'>`, because `external` has no
caller yet. When the last call site converts, `WiredHost` and `HostAdapter`
are the same type and the alias goes away.

### Every call site, and what each host answers

| Call site | Extension host | Web host |
|---|---|---|
| `AuthScreen` 104/106/118 — `runtime.onMessage`, `sendMessage('initiateOIDCLogin')` | Background starts the PKCE flow and broadcasts the result | **Does not exist.** `AuthScreen` leaves the shared tree entirely (see Auth) |
| `WelcomeScreen` 23/34/53/57 — `storage.local.set`, `permissions.request`, `openOptionsPage` | First-run endpoint choice + `http://localhost/*` grant | **Does not exist.** The web host is served by the deployment it talks to; there is nothing to choose |
| `useConfiguredEndpoint` 39/42 — `storage.onChanged` | `endpoints.subscribe` → fires on Options save | `endpoints.subscribe` → returns an unsubscribe, never fires. Same code path, no branch |
| `useDataRecovery` 114/136/207, `useDataUpload` 333, `useMessageSubmission` 182/464 — `storage.local` | `store` over `browser.storage.local` | `store` over namespaced `localStorage` |
| `usePageContent` 16/102/105/115 — `tabs.query`, `permissions.*`, `scripting.executeScript` | `pageCapture.supported: true` | `pageCapture.supported: false` + reason + install link |
| `CollapsibleNavigation` 186/324, `SidePanelApp` 260 — `openOptionsPage` | `navigation.settings` → the options page | `navigation.settings: null` → no affordance rendered |
| `SidePanelApp` 313/322/324 — `tabs.query`/`update`/`create` ("Open Dashboard") | `navigation.dashboard(path)` → focus the existing dashboard tab, else create one | `navigation.dashboard(path)` → a router push. The page **is** the dashboard |

### Auth

The requirement is that the shared UI renders no sign-in in the web host. A
runtime branch would satisfy the letter and lose it the first time someone
forgets. The shape used here is structural:

**`session` is non-nullable on the adapter.** There is no adapter without a
session, so the UI has no state in which it must decide whether to show
`AuthScreen`. Authentication happens *above* the boundary, in each host's own
entry point:

- The **extension** entry keeps `WelcomeScreen`, `AuthScreen` and the
  `!isAuthenticated` gate, and constructs the adapter only once authenticated.
  `SidePanelApp` splits: the gate stays extension-side, the authenticated shell
  becomes the shared `CopilotPanel({ host })`.
- The **Dashboard** already has a session (`AuthContext` + `AuthManager`) and
  wraps the panel in a `HostAdapterProvider` built from it.

After PR 5, `grep -r "AuthScreen\|LocalLoginForm" packages/copilot-ui` is empty,
and that grep is the check.

The UI never holds a refresh token. It calls `session.accessToken()`; the host
owns rotation, the storage key and the lock. Risks 1 and 2 are why.

## c. Page capture in the web host

A web page cannot read another tab. The affordance stays visible; pressing it
explains why and links the store listing.

**The branch lives in `UnifiedInputBar.tsx`,** at the capture button
(lines 595–625) and its click handler `handlePageInjectClick` (line 338).
`ChatInterface.tsx:48` stops calling `usePageContent()` and reads
`useHost().pageCapture` instead, passing it down.

Concretely, `handlePageInjectClick` becomes:

```tsx
const { pageCapture } = useHost();

const handlePageInjectClick = async () => {
  if (!pageCapture.supported) {
    setValidationError({ type: 'info', message: pageCapture.reason,
                         action: { label: 'Install the extension', href: pageCapture.installUrl } });
    return;
  }
  // …existing capture path, now pageCapture.capture()
};
```

Three properties, each testable:

1. The button is **rendered and enabled** in both hosts. It is not hidden and
   not disabled — `disabled={… || !onPageInject || …}` on line 610 must not be
   allowed to become the web host's answer, because a disabled button explains
   nothing.
2. Pressing it in the web host produces the reason and the link, in the same
   validation-message slot the capture errors already use.
3. `pageCapture` being a union means there is no shape in which the UI can render
   the button and have nothing to say when it is pressed.

`usePageContent` itself becomes the extension host's implementation of
`pageCapture.capture()` — it moves under the host, not into the UI.

## d. Generated API types

Both repos hold a byte-identical `src/types/api.generated.ts` (sha256
`c9c3d641…`), both pin `FaultMaven/faultmaven@a879206c` at contract `2.0.0`, and
both run a regenerate-and-diff job against that pin.

**Keep both copies. Add a check that they agree.**

Collapsing to one copy — the Dashboard deleting its file and importing types
from the package — reads like de-duplication and is not. The Dashboard's
`api-types-drift` job regenerates *its own file* and diffs; with no file to
regenerate the job compares nothing and passes. Removing a copy would remove a
gate, which is the fail-open trade this whole document exists to refuse.

So:

- Each repo keeps `api-contract.pin.json`, `generate:api-types` and its
  drift job, unchanged. That is the **correctness** leg: each client matches the
  contract it pinned.
- The shared package carries its own copy and its own pin, and its imports
  resolve inside the package — so the shared UI is always typed against the
  package's contract, whatever the consuming repo pinned.
- Add one assertion to the Dashboard's `api-types-drift` job: the Dashboard's
  `api-contract.pin.json` `ref` and `contractVersion` must equal those of the
  installed `@faultmaven/copilot-ui`. That is the **consistency** leg. Without
  it, one bundle can contain two clients typed against two different contract
  versions, and structural typing means most of that compiles.

Both legs are needed. The correctness leg alone allows the two to be pinned at
different contracts; the consistency leg alone allows N copies to be wrong
together.

A spec change then reddens both repos the same way it does now — each drift job
regenerates and diffs — and reddens the pair if only one adopts.

## e. Migration sequence

Each PR ships on its own and proves one thing. PRs 2–7 change the extension
artifact; none changes the manifest surface, so one release upload covers them.

| PR | Change | What it proves |
|---|---|---|
| 1 | This document, `src/shared/host/adapter.ts`, and `playground/`. No behaviour change. | The existing UI renders and is interactive outside an extension context; the artifact is byte-identical. |
| 2 | `extensionHostAdapter` over `browser.*`; convert the 8 storage references (`useConfiguredEndpoint`, `useDataRecovery`, `useDataUpload`, `useMessageSubmission`) to `host.store`. | The adapter is exercised **in production, in the only host that exists**, before any second host depends on it. Existing tests stay green. |
| 3 | Convert navigation (`SidePanelApp` 260/313–324, `CollapsibleNavigation` 186/324) to `host.navigation`. | Mounted with `settings: null`, the panel renders **no** settings button — asserted, not assumed. |
| 4 | `host.pageCapture` union; `usePageContent` becomes the extension implementation; the `supported: false` branch in `UnifiedInputBar`. | With `supported: false` the button is present, enabled, and clicking renders the reason and the install link. |
| 5 | Move `AuthScreen`, `LocalLoginForm`, `WelcomeScreen` and the auth gate out of `SidePanelApp` into the extension entry; the shell becomes `CopilotPanel({ host })`. | `grep -r AuthScreen packages/copilot-ui` is empty. The panel cannot render a sign-in. |
| 6 | The API client takes its base URL and bearer from the host; `client.ts`/`fetch-utils.ts` stop reading storage and stop refreshing. | A CI grep finds no `browser.` and no token storage under the shared closure. Risks 1 and 2 are structurally out of reach. |
| 7 | Relocate the closure to `packages/copilot-ui/` — a move, no edits — plus `tailwind-preset.cjs`; the extension consumes it as a workspace dependency. | The extension build is unchanged in behaviour; the digest change is a pure move, landed alone so the baseline diff says so. |
| 8 | *(Dashboard repo)* Add the pinned dependency, adopt the preset, mount the panel, add the staleness gate and the pin-parity assertion. | The panel drives a real investigation with the Dashboard's own session; the staleness gate is verified red against the previous pin before it is trusted. |

PR 2 before PR 8 is deliberate: the adapter earns its shape in the host that
already exists, so the second host is not also the first test of the interface.

## f. Risks found in this code

Not generic risks — each of these is in the tree today.

**1. Two `AuthManager`s, one storage key, different shapes.** The Copilot writes
`browser.storage.local.set({ authState })`; the Dashboard writes the same
`authState` key through its `window.browser` shim (landing at
`localStorage['faultmaven_authState']`). The Copilot's `AuthState`
(`src/lib/api/types/index.ts:4`) has **no** `refresh_token`, `session_id` or
`idp_logout_url`; the Dashboard's (`src/lib/auth/types.ts`) has all three. Ship
the Copilot's auth stack into the Dashboard and its next full-row write silently
drops the refresh token and the IdP logout URL. Nothing throws.

**2. Two token refreshers that do not exclude each other.** The Copilot holds
Web Lock `'faultmaven-token-refresh'` (`token-manager.ts:124`); the Dashboard
holds `'fm-auth-refresh'` (`AuthManager.ts:12`). Different names, so no mutual
exclusion — and the refresh grant is single-use. Both in one page means the
loser of the race presents an already-rotated token and the user is signed out.

Risks 1 and 2 are why `HostSession` exposes `accessToken()` and nothing else.

**3. The Dashboard's existing `window.browser` polyfill cannot serve the shared
UI.** `wxt/browser` resolves to
`globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome`. The
Dashboard's shim (`src/lib/storage.ts`) sets `window.browser = { storage }` with
no `runtime`, so the guard falls through to `globalThis.chrome` — `undefined` on
a normal page. Verified. Every `browser.*` call in the shared UI is a TypeError
under that shim, not a silent no-op. The polyfill works only for the Dashboard's
own code, which reads `window.browser` directly.

**4. The two Tailwind configs have already drifted, and the drift is silent.**
`src/shared/ui` uses `bg-fm-bg` / `text-fm-bg` (6 sites), `font-fm-sans`
(`SidePanelApp.tsx:277`) and `font-fm-mono` (`MarkdownRenderer.tsx`). **None of
those three tokens exists in the Dashboard's `tailwind.config.cjs`.** The
Copilot also sets `darkMode: 'class'`; the Dashboard does not. A missing Tailwind
token is not an error — the class is simply never emitted, and the element
renders unstyled. Hence the shared preset.

**5. Root-absolute asset paths.** `src/shared/ui` references `/icon/*.svg` from
five files — `ChatWindow.tsx:385,640`, `ChatInterface.tsx:63`,
`CollapsibleNavigation.tsx:142,217`, `AuthScreen.tsx:174`,
`WelcomeScreen.tsx:78`. Those resolve inside the extension package and 404
anywhere else, as a broken `<img>` with nothing thrown. Observed in the proof
before `publicDir` was pointed at `public/`.

**6. The named boundary is about a fifth of the real one.** 27 direct references
in `src/shared/ui`; 106 more in the 22 transitive modules it imports. Any plan
scoped to `src/shared/ui` alone under-scopes the extraction by 4×.

**7. Copies that already exist, one already rotten.** See the table at the top.
`faultmaven-dashboard/src/types/case.ts` is the proof that the failure mode is
real here and not theoretical: copied, diverged, unreferenced, unnoticed.

**8. `ChatWindow`'s case header needs a Copilot session id the Dashboard does
not have.** `ChatWindow.tsx:103–108` queries `GET /cases/{id}/ui` with
`enabled: Boolean(activeCase?.case_id && sessionId)`, and `EnhancedCaseHeader`
renders entirely from that response — with no session it shows "No case data
available" and ignores the `activeCase` prop it was handed. Visible in the proof
screenshot. The Dashboard has no notion of that session. Decision D2.

**9. `typeof browser !== 'undefined'` is a fail-open guard.**
`CollapsibleNavigation.tsx:185,323` renders the "Open Settings" affordance
unconditionally and then does nothing when pressed in a host without `browser` —
the worst of both.

**10. One key, two writer paths.** `faultmaven_current_case` is written from
`src/shared/ui` (three sites) and from the lib closure —
`state/slices/cases-slice.ts:75,77`, `utils/persistence-manager.ts:350`,
`auth/user-scope.ts:75`. In the extension both land in the same store, so this
is invisible today; it means the key is not host-independent until the closure
is converted, and that converting the UI's own call sites is not by itself
enough to move a key across the boundary. Resolved in PR 6.

## The proof

`playground/` renders the existing chat UI in a plain Vite page: no extension
context, no manifest, no service worker, no `browser` global.

```bash
pnpm install
pnpm playground          # dev server on http://localhost:5174
pnpm playground:build    # production build into playground/dist
```

- `App.tsx` imports `ChatInterface` **unmodified** from `src/shared/ui` — the
  same files the extension builds, resolved through the same `~` / `~lib`
  aliases, not a copy.
- `web-host.ts` is a stub `HostAdapter`: `localStorage` for `store`, the page
  origin for `endpoints`, `settings: null`, `pageCapture.supported: false`, and
  a stub **already-authenticated** session.
- `wxt-browser.ts` is scaffolding, aliased over `wxt/browser` in
  `playground/vite.config.ts`, so the UI runs *unmodified* — wrap, not
  relocate. What a web host can answer is delegated to the adapter; what it
  cannot throws, naming the adapter member that replaces the call site. Those
  throw messages are the migration checklist, and the file is deleted by PR 6.

Verified in headless Chromium against the production build:

| Check | Result |
|---|---|
| Transcript, case header and input bar render from `src/shared/ui` | yes |
| Any sign-in / password / "continue with" copy in the tree | none |
| Page-capture button visible **and enabled** | yes |
| Pressing it produces an explanation | yes |
| Install link points at the real store listing | yes |
| Typing and sending appends a turn | yes |
| Theme tokens resolve (`bg-fm-canvas` → `rgb(15, 23, 42)`) | yes |
| Uncaught page errors other than the intended capture explanation | none |

And the cost to the extension:

```
$ pnpm zip && pnpm extension:digest
Extension artifact unchanged (d444c72623fb, 127 files, v1.0.3).
```

Nothing in `src/shared/ui` changed. The only additions are
`src/shared/host/` (a declaration, imported by nothing in the extension) and
`playground/`, which WXT never sees.

The proof's limits, stated plainly: nothing reaches a backend, `sessionId` is
`null` so `ChatWindow`'s one query is disabled, and the submit handlers echo
locally. It shows the host boundary is real. It does not show the panel working
against a live deployment — that is PR 8.

## Open questions

| # | Question | Why it needs the architect |
|---|---|---|
| D1 | Option B with a staleness gate, or Option C (monorepo)? | C is the only option where divergence is impossible rather than detectable. It costs moving the Dashboard's release train, its GHCR publish and its gates. A product-shape call, not a technical one. |
| D2 | Does the Dashboard panel mint a Copilot session (`POST /sessions`), or does `ChatWindow` stop requiring `sessionId` for the case header? | Risk 8. Without an answer the header renders empty in the web host. |
| D3 | Is the Dashboard's account menu the only sign-out (`signOut: null`)? | Two sign-outs that clear different halves of the state is worse than one. |
| D4 | Does the web host ever get a settings surface, or is `navigation.settings: null` permanent? | Endpoint configuration is meaningless in a host served by its own deployment — but "Settings" may mean something else there later. |
| D5 | Shared Tailwind preset, or two configs plus a token-parity test? | The preset is the stronger fix and touches both repos' build config. |
| D6 | Does the extension keep its own `client.ts` and refresh loop, with the package's client taking a token — or does the background worker become the sole refresher for both? | Determines how much of `src/lib/api` and `src/lib/auth` moves into the package in PR 6. |
| D7 | One store upload at the end of the sequence, or ship each artifact-changing PR? | The digest guard tracks; it does not force. Release cadence is a product call. |
| D8 | If C: does `faultmaven-dashboard` move into `faultmaven-copilot` (and this repo get renamed), or do both move into a new frontends repo? | Affects infra references, the image name and the tag namespace. |
