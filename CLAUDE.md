# CLAUDE.md

Guidance for Claude Code when working in this repository.

**FaultMaven Copilot** is the browser extension: a side panel that talks to a
FaultMaven backend (Cloud or self-hosted). WXT 0.20 (MV3 for Chromium, MV2 for
Firefox), React 19, TypeScript, Tailwind, Zustand + TanStack Query, Vitest,
Playwright. Package manager is pnpm.

## Commands

```bash
pnpm install                  # also runs `wxt prepare`
pnpm dev / pnpm dev:firefox   # HMR dev build
pnpm build / pnpm build:firefox
pnpm zip / pnpm zip:firefox   # store-ready zips in .output/
pnpm compile                  # tsc --noEmit for src/ AND the package
pnpm lint                     # eslint src packages
pnpm test                     # vitest (add --watch); test:ui, test:coverage
pnpm test:e2e                 # playwright e2e/ (needs `pnpm build` first)
pnpm generate:api-types       # regenerate the API client from the pinned contract
pnpm extension:digest         # compare the built Chrome artifact to extension-baseline.json
pnpm playground               # the shared UI against a stub web host, :5174
```

Pre-commit (husky) runs `node scripts/brand-lint.mjs && npm run compile && npm run test`.
CI (`.github/workflows/ci.yml`) runs `compile`, `api-types-drift`, `test:coverage`,
and `build` (both zips, manifest version == `package.json`, `extension:digest`).

## Layout

Two trees, one boundary. Read [docs/HOST_INDEPENDENT_UI.md](docs/HOST_INDEPENDENT_UI.md)
before moving code across it.

```text
packages/copilot-ui/      @faultmaven/copilot-ui — the panel and everything it needs.
                          Consumed by this extension as a workspace dependency and by
                          the Dashboard as a git dependency pinned by SHA.
  index.ts                the supported entry for a host
  contract.ts             cross-repo handshake names (import from '/contract' in content scripts)
  shared/host/adapter.ts  the HostAdapter contract a host implements
  shared/ui/              CopilotPanel.tsx, components/, hooks/, layouts/
  lib/                    api/ (client, services, session-core), state/ (Zustand store + slices),
                          errors/, optimistic/, session/, utils/ (logger, memory-manager, …)
  types/                  case.ts + api.generated.ts (GENERATED — never hand-edit)
  config.ts               build-time VITE_* constants (input limits, session timeout)
src/                      the extension host and nothing else
  entrypoints/            background.ts (service worker), auth-bridge.content.ts,
                          sidepanel_manual/, options/
  extension/              ExtensionApp.tsx (mounts CopilotPanel), messaging.ts (EventBus),
                          side-panel-yield.ts, auth/ (token chain, OAuth, local auth,
                          teardown), host/ (HostAdapter implementation, endpoints,
                          page capture, session credential), components/ (sign-in screens)
  test/                   vitest suite (mirrors both trees) + manifest/ and packages/ guards
playground/               the host-independence proof: the package mounted in a plain web page
e2e/                      Playwright against the built extension
scripts/                  generate-api-types, extension-digest, brand-lint, sync-ui-assets, icons
```

Rules the layout enforces (`src/test/packages/` pins them — `closure-boundary`,
`preset-tokens`, `package-assets`, `contract-entry`, …):

- **No path aliases.** Import the package by name:
  `import { createLogger } from '@faultmaven/copilot-ui/lib/utils/logger'`.
  Inside the package every import is relative.
- **The package reaches no extension API, holds no credential and imports no
  runtime messaging.** Sign-in screens, the token chain, page capture and
  endpoint settings are the extension's (`src/extension/`). The UI asks the host
  for an access token (`session.accessToken()`); it never sees a refresh token.
- **`HostAdapter` has no optional capability or method** — a capability a host
  lacks is a union arm carrying a reason, or an explicit `null` — and `kind` is
  for copy and telemetry, never for behaviour.

## Configuration

- Endpoints are **runtime settings**, not env: `apiBaseUrl` and `dashboardUrl`
  in `browser.storage.local`, Cloud defaults when unset, configured
  independently (no derivation of one from the other — a one-time migration
  seed from the legacy `apiEndpoint` key aside). `src/extension/host/endpoints.ts`;
  user-facing model in [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).
- Build-time knobs are `VITE_*` (`packages/copilot-ui/config.ts`, polling in
  `lib/api/services/case-service.ts`, heartbeat in `lib/state/slices/session-slice.ts`,
  `VITE_DEBUG` in the logger).
- `FM_STORE_KEY=<store item public key> pnpm build` gives an unpacked build the
  **published extension id** — the only OAuth redirect FaultMaven Cloud admits.
  Pass it per invocation; never put it in a dotenv file or a workflow
  (`wxt.config.ts` `storeIdentity`, `src/test/manifest/store-key-optin.test.ts`).

## Hard rules

**Logging.** `createLogger('Name')` from `@faultmaven/copilot-ui/lib/utils/logger`;
never `console.*`. `debug`/`info` are dev-only, `warn`/`error` always. Log one
structured object per operation, not `JSON.stringify` and not several lines.

**Cross-context events.** `EventBus` (`src/extension/messaging.ts`) wraps
`browser.runtime.sendMessage`/`onMessage`. `emit` never reaches the sender's own
context; `on` returns the unsubscribe. `EventType` in `messaging.ts` is the list.

**Chrome vs Firefox.** Feature-detect, never branch on a build-target list:
Firefox has no `browser.sidePanel`; `side-panel-yield.ts`'s `panelSurface()`
feature-detects Chromium's `sidePanel` or Firefox's `sidebarAction` (declared
for Firefox only) — the MV2 build registers a `browserAction` →
`sidebarAction.open()` opener and the same per-tab yield, and on Firefox a
yielded tab shows the `panel_yielded.html` placeholder instead of hiding. Its
OAuth redirect host is derived from the add-on id
(`<hash>.extensions.allizom.org`) rather than `<id>.chromiumapp.org`
(`src/extension/auth/dashboard-oauth.ts`). Chromium-only manifest keys (`key`,
`minimum_chrome_version`) are gated on `CHROMIUM_TARGETS` in `wxt.config.ts`
because WXT does not strip them from the Firefox output and AMO warns on them.
Firefox-specific self-hosting limits: [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

**Manifest.** The comments in `wxt.config.ts` are the authoritative rationale;
`src/test/manifest/` pins them. `tabs` is an *optional* permission requested at
capture time (a required `tabs` puts "Read your browsing history" on the install
dialog); there is no `activeTab`; `identity` is `launchWebAuthFlow` only, never
`getProfileUserInfo`. A permission, host-permission or CSP change is also a store
listing change — see [docs/RELEASING.md](docs/RELEASING.md). Page capture is
http/https only, by allowlist (`src/extension/host/extension-page-capture.ts`);
`file://` is not runtime-grantable.

**Auth.** Two modes, auto-detected from `GET /api/v1/auth/config`: `local`
(username/password, `POST /api/v1/auth/refresh`) and `oauth` (PKCE via the
Dashboard, `POST /api/v1/auth/oauth/token`). The refresh endpoint follows the
mode; `/oauth/token` is not mounted in local mode. Credentials live only in
`browser.storage.local` under the keys in `src/extension/auth/storage-keys.ts`.
`TokenManager.assess()` is the one verdict on a credential, TokenManager never
ends a session, and `authManager.clearAllAuthData()` is the one teardown. The
full contract is `src/extension/auth/CLAUDE.md`; `.claude/rules/credential-chain.md`
points there from the host files that take part (`session-credential.ts`,
`auth-state.ts`, `ExtensionApp.tsx`, `background.ts`, options `main.tsx`).

**Side-panel yield.** On a Dashboard tab that is *currently showing* its own
copilot panel, the extension's panel hides; every ambiguous case shows it. Rule
in `.claude/rules/side-panel-yield.md`; code in `src/extension/side-panel-yield.ts`.

**Shared-UI contracts** (transcript row kinds, cache versioning, persistence,
error bodies, rate-limit recovery, case status actions, optimistic ids) are in
`packages/copilot-ui/CLAUDE.md`, which loads when you touch the package.

**API types.** `packages/copilot-ui/types/api.generated.ts` is generated from the
core commit pinned in `api-contract.pin.json`; never edit it by hand and never
generate from a live server. Adopting a contract = moving `ref` +
`contractVersion` and regenerating, in one PR. Preparing against an unmerged
core PR uses `--spec`. Details: [docs/API_CONTRACT.md](docs/API_CONTRACT.md).

**Releases.** `package.json` is the only version source. Anything that changes
the built artifact must refresh `extension-baseline.json` in the same PR
(`pnpm zip && pnpm extension:digest:write`). Tag `vX.Y.Z` on the merge commit;
`release.yml` builds and attaches both zips; the store upload is manual.
[docs/RELEASING.md](docs/RELEASING.md).

**Store identity and redirects.** The Cloud OAuth allowlist admits the published
extension id only. A sideloaded build without `FM_STORE_KEY` cannot sign in to
Cloud; that is by design, not a bug to route around.

## Working here

- Conventional Commits; feature branches; PRs against `main`.
- A repo-wide `git grep CLAUDE.md` must resolve after any move of these files:
  code comments in `src/extension/auth/` and
  `packages/copilot-ui/shared/ui/components/case-header/CaseDetails.tsx` cite them.
- Docs: [ARCHITECTURE.md](ARCHITECTURE.md) (design overview),
  [docs/HOST_INDEPENDENT_UI.md](docs/HOST_INDEPENDENT_UI.md),
  [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md), [docs/RELEASING.md](docs/RELEASING.md),
  [docs/API_CONTRACT.md](docs/API_CONTRACT.md), [CONTRIBUTING.md](CONTRIBUTING.md).
