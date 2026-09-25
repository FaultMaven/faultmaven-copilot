---
paths:
  - "src/extension/side-panel-yield.ts"
  - "src/extension/auth/presence-marker.ts"
  - "src/extension/auth/trusted-origin.ts"
  - "src/entrypoints/background.ts"
  - "src/entrypoints/auth-bridge.content.ts"
  - "packages/copilot-ui/contract.ts"
  - "packages/copilot-ui/index.ts"
  - "packages/copilot-ui/shared/host/index.ts"
  - "src/test/entrypoints/side-panel-yield.test.ts"
  - "src/test/entrypoints/auth-bridge-panel-advertisement.test.ts"
  - "src/test/packages/panel-advertisement.test.ts"
  - "src/test/lib/auth/presence-marker.test.ts"
---

# The side panel yields to a Dashboard that is showing its own

The panel opens **window-wide** (`sidePanel.open({ windowId })` from the
toolbar-icon handler), so it is up on every tab in that window — including a
Dashboard tab that renders the copilot itself. `src/extension/side-panel-yield.ts`
is the whole rule; its header comment is the design record.

**Invariant.** On a tab whose origin is a configured Dashboard origin AND whose
page is *currently showing* a built-in panel, the extension's panel is hidden.
On every other tab — including a Dashboard that does not advertise — it behaves
as if this module did not exist.

**The claim is live, not a property of the build.** The three names in
`@faultmaven/copilot-ui/contract`:

| Name | Meaning | Effect |
|---|---|---|
| `DASHBOARD_PANEL_ATTR` | build capability — "this deployment could host a panel" | none (not acted on) |
| `DASHBOARD_PANEL_MESSAGE` | "a panel is showing on this tab, right now, for this user" | yields |
| `DASHBOARD_PANEL_WITHDRAWN_MESSAGE` | "…not any more" | releases |

They live in the package because both repositories need the same names;
`src/extension/auth/presence-marker.ts` re-exports them so the extension has one
door to the handshake in both directions. Import from `/contract`, never the
package entry — the entry brings the panel, the store and the transport with it,
into a **content script**.

**Three release paths, one yield path.**

- `yieldSidePanelForAdvertisedTab(tabId, origin)` — the only thing that hides
  the panel. Origin-gated against `isTrustedDashboardOrigin`, using the origin
  the **browser** attributed to the sender, never the message body.
- `releaseSidePanelForTab(tabId, 'withdrawn')` — the retraction, on
  `DASHBOARD_PANEL_WITHDRAWN_MESSAGE`. **Deliberately not origin-gated**: hiding
  is the severe failure and is checked hard; showing is the mild one, and a
  check here could strand a tab dark. Safe because `releaseTab` rewrites only
  options that say `enabled: false`, and `yieldTab` is the **sole writer** of
  that — anything that ever disables a panel for another reason breaks that
  reading.
- `reconcileSidePanelForTab(tabId, url, { documentReplaced })` — runs on every
  `tabs.onUpdated`, and **leaves Dashboard tabs alone unless the document is
  being replaced**, in which case it releases: the assertion belonged to the
  document going away. `documentReplaced` comes from
  `changeInfo.status === 'loading'` and nothing else.
- `reconcileSidePanelForAllTabs()` — at worker startup, and from the
  `storage.onChanged` listener when `dashboardUrl` changes: an origin that has
  just stopped being the Dashboard gives its tabs their panel back. This pass
  can only release; the new origin's tabs stay as they are until their pages
  advertise.

The browser's own per-tab `enabled: false` is the memory — nothing is kept in
the worker, which MV3 evicts routinely.

**Every write to one tab is serialized** through `onTab(tabId, work)`. The yield
and the release are both read-modify-write on the same options, dispatched
without awaiting, with awaits of different length (the yield resolves
`isTrustedDashboardOrigin`, which for a self-hosted origin reads storage).
Unserialized, an advertise immediately followed by a withdrawal can leave
**neither surface, with the withdrawal already spent**.

**Accepted costs.**

- A flash on load: the extension's panel is briefly visible before a Dashboard
  that hosts one asserts. Every ambiguous branch fails towards *showing*.
- Cross-repo release order: an extension that predates
  `DASHBOARD_PANEL_WITHDRAWN_MESSAGE` ignores it and leaves the tab yielded, so
  this side must be in the field before the Dashboard starts withdrawing.
- The page must re-assert on `pageshow`, not only on mount: `status: 'loading'`
  is reported for a bfcache back/forward, an aborted navigation and a link that
  becomes a download, none of which re-inject a content script or re-run a
  React effect. The extension cannot fix this from its side. Recorded in
  `contract.ts` where the Dashboard implementer reads it.

Firefox has no `browser.sidePanel`. The yield handlers above are registered
inside `if (browser.sidePanel)` in `background.ts` — guarded on the API's
presence rather than the build target — so the MV2 build registers none of them.
The toolbar `action.onClicked` handler is registered outside that guard.
