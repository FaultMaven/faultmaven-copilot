# Host-independent Copilot UI

The Copilot UI is one source, `packages/copilot-ui`, published from this
repository as `@faultmaven/copilot-ui`. The extension consumes it as a workspace
dependency; the Dashboard consumes it as a git dependency pinned by SHA. Neither
host contains a copy of it.

## The invariant

A change to the UI reaches both hosts through that one package or reaches
neither. The failure this is designed against is not breakage — it is a fix that
lands in one host and not the other with nothing red.

Three things carry the invariant, and each is a test rather than a habit:

| Property | Where it is asserted |
|---|---|
| The package reaches no extension API, holds no credential and imports no runtime messaging — anywhere in its import closure | `src/test/packages/closure-boundary.test.ts` |
| Every `fm-*` class the package uses resolves to css from the package's own preset | `src/test/packages/preset-tokens.test.ts` |
| Every asset the package references, the package ships, and the host serves | `src/test/packages/package-assets.test.ts` |

## The package

```
packages/copilot-ui/
  index.ts               the supported surface for a host
  shared/host/adapter.ts  the host contract
  shared/ui/              the panel, its components, layouts and hooks
  lib/                    state, api client, optimistic updates, errors, persistence
  types/                  case types and the generated API types
  config.ts               build-time constants
  styles/                 globals.css + response-formatting.css
  public/icon/            the logo the UI renders
  tailwind-preset.cjs     the theme
  tsconfig.json           its own; `pnpm --filter @faultmaven/copilot-ui build` stands alone
```

It has no path aliases. An alias resolves against the *consumer's* config, so a
package that used one would compile here and break in the Dashboard; every
import inside the package is relative, and the closure test's resolver
understands nothing else.

### What is not in it

The credential stack, runtime messaging, extension-reload detection, page
capture, the sign-in screens and the endpoint configuration are all the
extension's, under `src/extension/`. `src/` holds the extension and nothing
else: entry points, the host implementation, and the auth stack that owns the
token chain.

## The host contract

`shared/host/adapter.ts`. A host builds one object:

```ts
interface HostAdapter {
  readonly kind: 'extension' | 'web';
  readonly store: HostStore;            // get/set/remove/subscribe over keys
  readonly endpoints: HostEndpoints;    // apiUrl/dashboardUrl, and a subscription
  readonly navigation: HostNavigation;  // dashboard(path), external(url), settings | null
  readonly session: HostSession;        // NON-NULLABLE
  readonly pageCapture: HostPageCapture; // a union, not an optional method
}
```

Four rules the shape enforces rather than documents:

- **Nothing is optional-by-undefined.** A capability a host lacks is a union arm
  carrying a reason the UI renders, or an explicit `null` that removes the
  affordance — never a missing method the UI probes for.
- **`session` is non-nullable**, so the panel has no state in which it must
  decide whether to show a sign-in. Authentication happens above the boundary,
  in each host's entry point. `grep -r "AuthScreen\|LocalLoginForm"
  packages/copilot-ui` is empty, and a test asserts it.
- **The UI never holds a refresh token.** It calls `session.accessToken()`; the
  host owns rotation, the storage key and the lock. Two independent refreshers
  in one page rotate the same single-use grant against each other.
- **`kind` is for copy and telemetry, never behaviour.** A branch on `kind` is a
  capability the interface failed to model.

`HostSession` also carries `signOut` (`null` where the host's own account menu
owns it), `onUnauthorized`, and `subscribeAuthState` — the one thing the shared
UI needed cross-context messaging for, modelled as the fact ("who is signed in
now, or nobody") rather than the mechanism. The extension sources it from
`runtime.onMessage` and from its credential key being cleared; a web host
answers from its own auth layer, because another tab signing out is a real event
on a web page.

### The two module singletons

The Zustand store, its slices, the session machinery and the request path are
plain modules called from effects and background continuations, so they cannot
read React context. A host installs its answers once per context, at its entry
point, before anything reads them:

```ts
setHostStore(myStore);
setHostEndpoints(myEndpoints);
setApiTransport(myTransport);   // once a session exists
```

Reads before installation **throw**. A silent default is the failure this
replaces: an endpoint resolver that fell back to the Cloud URL would point a
self-hosted deployment at `api.faultmaven.ai` and log nothing.

`HostEndpoints.apiUrl()` and `ApiTransport.baseUrl()` both answer "where is the
backend", and the line between them is the session: a request the UI issues on
behalf of a session takes its base URL from the transport; anything that can run
before a session exists (an auth-mode probe, a code exchange, sign-in, a
refresh, a capabilities fetch) takes it from the endpoints.

## Mounting the panel in a host

```tsx
import CopilotPanel, {
  HostAdapterProvider, setHostStore, setHostEndpoints, setApiTransport,
  type HostAdapter,
} from '@faultmaven/copilot-ui';
import '@faultmaven/copilot-ui/styles/globals.css';

// once per context, before React mounts
setHostStore(host.store);
setHostEndpoints(host.endpoints);

// and, once the surrounding app has a session
setApiTransport({
  baseUrl: () => host.endpoints.apiUrl(),
  accessToken: () => session.accessToken(),
  sessionId: () => …,
  clearSession: () => …,
  onUnauthorized: () => session.onUnauthorized(),
});

<CopilotPanel host={{ ...capabilities, session }} />
```

`playground/` is that, in about 200 lines, against a stub host: `localStorage`
for the store, the page origin for the endpoints, `settings: null`,
`pageCapture.supported: false`, and a session handed in already authenticated.
It imports the package **by name, through the entry**, with no alias, so it
cannot pass by reaching into files a real consumer could not.

```bash
pnpm playground          # http://localhost:5174
pnpm playground:build
```

## Theme

`packages/copilot-ui/tailwind-preset.cjs` carries the `fm-*` tokens and
`darkMode: 'class'`. Both hosts consume it as a preset and add only their own
`content` globs:

```js
module.exports = {
  presets: [require('@faultmaven/copilot-ui/tailwind-preset.cjs')],
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
};
```

The preset globs the package's own sources, so a host that forgets to add
`node_modules/@faultmaven/copilot-ui` still gets the classes the shared UI uses.
That matters because a missing Tailwind token is not an error: the class is
simply never emitted and the element renders unstyled, with nothing thrown.
`preset-tokens.test.ts` runs Tailwind over the package's sources and asserts
every `fm-` class they use came out as a rule — a deleted token, a mistyped
class and a `content` glob that stopped matching are all the same failure there.

## Assets

The UI references its logo as `/icon/*.svg`, root-absolute, which is the one
form that resolves identically in an extension page and on a web page. Those
files live in `packages/copilot-ui/public/`, and each host serves that
directory at its web root:

- the **playground** points Vite's `publicDir` at it;
- the **extension** copies it into `public/` before every dev, build and zip
  (`scripts/sync-ui-assets.mjs`, wired into `predev`/`prebuild`/`prezip`); the
  copies are gitignored, so exactly one version of each file is committed;
- the **Dashboard** will do whichever of the two its static pipeline prefers.

`package-assets.test.ts` asserts the package ships everything it references and
that the extension serves it. A missing asset is otherwise a broken `<img>`,
with nothing thrown and nothing red.

## How the Dashboard consumes it

A git dependency pinned by SHA to the package's subpath:

```jsonc
// faultmaven-dashboard/package.json
"@faultmaven/copilot-ui": "github:FaultMaven/faultmaven-copilot#<40-char-sha>&path:packages/copilot-ui"
```

Both repositories are public, so no install-time token is needed in either CI.
The package ships TypeScript sources and the Dashboard compiles them — which is
what lets the theme stay one system (a preset the Dashboard's Tailwind consumes)
rather than a stylesheet frozen at publish time.

**Verified against pnpm 10.22.0**, installing into a throwaway consumer outside
this repository. Both forms resolve, with and without the leading slash:

```
github:FaultMaven/faultmaven-copilot#<sha>&path:/packages/copilot-ui
github:FaultMaven/faultmaven-copilot#<sha>&path:packages/copilot-ui
```

pnpm fetches `https://codeload.github.com/FaultMaven/faultmaven-copilot/tar.gz/<sha>`,
extracts the subdirectory, and records both the tarball and the path in the
lockfile. The package's `files` list is honoured, so a consumer receives
`index.ts`, `lib/`, `shared/`, `types/`, `styles/`, `public/`,
`tailwind-preset.cjs` and `config.ts` — and none of this repository's tests,
docs or extension.

The one thing a consumer must supply: **`vite/client` in its `types`**, because
the package reads `import.meta.env` for its build-time constants. Nothing else
is required — in particular NOT `@types/node`, which a browser UI package has no
business demanding of the app that embeds it.

This is the pin-and-adopt idiom both repositories already run for the API
contract: the producer publishes by merging, the consumer adopts by moving a
ref, and a required check makes the gap visible.

### The staleness gate

**A pin makes a consumer stable, not current.** Under a SHA pin the Dashboard
can sit six months behind with every check green, which is the original failure
wearing a pin. So the Dashboard's `main` carries a required check that:

1. reads the pinned SHA out of its `package.json`;
2. resolves `FaultMaven/faultmaven-copilot@main`;
3. fails when the `packages/copilot-ui` subtree differs between the two,
   naming the commits.

Adopting is moving the pin. Refusing to adopt is an explicit, reviewed act
rather than silence. **The gate must be verified in its own failure state before
it is trusted:** point the pin one commit back and confirm it goes red.

### The pin-parity assertion

Both repositories keep their own `api-contract.pin.json`, their own
`generate:api-types` and their own regenerate-and-diff job. That is the
**correctness** leg: each client matches the contract it pinned. Collapsing to
one copy would delete a gate — the Dashboard's drift job would have no file to
regenerate and would pass having compared nothing.

The Dashboard's drift job gains one assertion, the **consistency** leg: its
`api-contract.pin.json` `ref` and `contractVersion` must equal those of the
installed `@faultmaven/copilot-ui`. Without it one bundle can hold two clients
typed against two contract versions, and structural typing means most of that
compiles.

Both legs are needed. Correctness alone allows the two to be pinned at different
contracts; consistency alone allows N copies to be wrong together.

## Chrome Web Store

CI hashes the built artifact (`scripts/extension-digest.mjs`) against a
committed baseline, so an artifact change is allowed and a *silent* one is not.
Two signals, deliberately separate:

- **`package`** — "must ship as a new version before release". Moving the UI
  into a package changes it: chunk names follow file paths. One release upload
  covers it.
- **`manifestSurface`** — permissions, hosts, CSP. Store review compares these
  against the listing's justification text, so a change here needs the listing
  updated too. **Nothing in this architecture touches it.** No permission is
  added or removed; page capture uses `tabs` + `scripting` +
  `optional_host_permissions` exactly as before, and the web host adds no
  manifest surface because it is not an extension.

## Open questions

| # | Question |
|---|---|
| D2 | Does the Dashboard panel mint a Copilot session (`POST /sessions`), or does `ChatWindow` stop requiring `sessionId` for the case header? Without an answer the header renders empty in the web host. |
| D4 | Does the web host ever get a settings surface, or is `navigation.settings: null` permanent? |
| D7 | One store upload per release train, or per artifact-changing PR? The digest guard tracks; it does not force. |
