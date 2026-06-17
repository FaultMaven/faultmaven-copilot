# Self-Hosting the FaultMaven Copilot

How the browser extension connects to a FaultMaven backend, and how to point it
at a self-hosted deployment. This document describes the configuration model as
implemented; it is the reference for both Cloud and self-host setups.

## The two endpoints

The extension talks to **two independent services**, configured separately. It
does not derive one from the other.

| Setting | Storage key | Used by | Required |
|---------|-------------|---------|----------|
| **API base URL** | `apiBaseUrl` | The copilot's backend — every chat/case/auth request | Yes |
| **Dashboard URL** | `dashboardUrl` | OAuth login redirect and dashboard deep-links | Only for OAuth-mode / Cloud |

For a self-hosted deployment using **local username/password auth**, only the API
base URL matters. The Dashboard URL is needed only when the backend uses the
OAuth (PKCE) login flow.

### Defaults (zero-config Cloud)

When nothing is configured, the extension targets FaultMaven Cloud:

- `apiBaseUrl` → `https://api.faultmaven.ai`
- `dashboardUrl` → `https://app.faultmaven.ai`

So a fresh install "just works" against Cloud with no setup.

### No more derivation

Earlier builds stored a single Dashboard URL and *derived* the API URL by string
substitution (`app.`→`api.`, `:3333`→`:8090`). That only worked for FaultMaven's
own domain convention and produced a wrong API host on any other domain. The API
base URL is now set **explicitly**; there is no derivation.

## Deployment tiers

| Host | Scheme | Notes |
|------|--------|-------|
| `localhost` / `127.0.0.1` | `http://` OK | Browsers treat localhost as a secure context, so plain HTTP works. This is the zero-config trial path. |
| Any other host (LAN IP, custom domain) | **`https://` required** | Off-localhost, the browser requires HTTPS for the secure-context features the extension relies on (secure cookies, service worker, no mixed content). |

The extension does not provision TLS. "Bring your own HTTPS / reverse proxy" is
the supported answer for custom domains. The extension's responsibility is only
to **work correctly when given an HTTPS endpoint** — no hardcoded `http://`, no
assumptions that break off-localhost. On save, a non-localhost `http://` URL is
rejected with a clear message.

## How configuration works

1. Open the extension **Options** page.
2. Enter the **API base URL** (and **Dashboard URL** if using OAuth login).
3. **Test connection** pings the API base URL and reports success or an
   actionable error (unreachable / cert error / wrong host) — no silent dead
   copilot.
4. On save, the extension requests **host permission** for the configured
   origin(s) at runtime (a standard Chrome per-site permission prompt). Hosts are
   not baked into the manifest; they are granted on demand via
   `optional_host_permissions`. This is also the cleaner Chrome Web Store posture
   (broad static host permissions trigger heavier review).

### Auth bridge (OAuth only)

For OAuth login, a small content script (the "auth bridge") runs on the Dashboard
origin to forward the login result to the extension. It is **registered at
runtime** (`chrome.scripting.registerContentScripts`) for the configured Dashboard
origin once host permission is granted — not hardcoded in the manifest. The bridge
validates `event.origin` against the configured Dashboard origin (read from
storage) before trusting any message, so it cannot be driven by an arbitrary page
that happens to share a localhost port.

## Backward compatibility

Existing installs stored the Dashboard URL under the legacy `apiEndpoint` key. On
read, if the new `apiBaseUrl` is absent but `apiEndpoint` is present, the
extension performs a one-time migration: it seeds `dashboardUrl` from
`apiEndpoint` and derives `apiBaseUrl` once using the old rule, then writes the
new keys. No user action required.

## Deferred — intentionally not built yet

The following are deferred by choice, not missing by oversight (tracked in a
GitHub issue):

- Polished custom-domain UX, automated certificate issuance, one-click TLS.
- Dashboard deep-linking beyond the OAuth redirect.

The configuration above is what makes a self-host setup *possible*; the polish
waits for real demand. There is **no laptop-only / no-remote restriction** — a
team self-hosting on a LAN or server (multi-user) is expected to work.
