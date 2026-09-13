/**
 * The Dashboard-panel advertisement, defined ONCE — and reachable without the
 * panel.
 *
 * `@faultmaven/copilot-ui/contract` is a subpath entry with NO imports, and it
 * must stay that way. The three names below are needed by code that has no
 * business loading the UI: the Dashboard's login page, which decides what to
 * advertise before anyone is signed in, and the extension's content script,
 * which reads the attribute on every page it is injected into. Reached through
 * the package's main entry they arrive with the store, the transport and the
 * persistence layer attached — 776 -> 983 kB on the Dashboard's login bundle,
 * which ADR-016 D3 forbids, and a 4 MB content script here.
 *
 * A test asserts the transitive import graph of this module is exactly itself,
 * so the next edit cannot quietly re-attach it.
 *
 * A page that renders the Copilot panel itself says so, and the extension's
 * side panel stands down on that tab rather than sitting beside a second copy
 * of itself. Three names carry it, and all three are a cross-repo contract:
 * the page writes them, the extension reads them, and a copy in either
 * repository is a copy that can drift while both sides stay green.
 *
 * It lives in the package because the package is the one thing both hosts
 * already share.
 *
 * SEMANTICS, exactly (revised by ADR-018 D0 — see the note below):
 * - The signal is a CLAIM BY THE PAGE: "a built-in panel is showing on this
 *   tab right now, for this user, on this route." It WAS a per-document-load
 *   claim about the build; D0 made it live, because a build-level claim cannot
 *   express a per-user preference or a route that mounts no panel.
 * - Advertising is OPT-IN and silence is the safe answer. A Dashboard that says
 *   nothing — an older self-hosted image, or Cloud before its own panel ships —
 *   keeps the extension's side panel exactly as it is. Nothing here may ever be
 *   inferred from the origin alone; that is the whole point of the signal, and
 *   why a version check or a build-date guess is not a substitute.
 * - The ATTRIBUTE is a BUILD CAPABILITY claim — "this deployment could host a
 *   panel" — answerable at document_start. Since ADR-018 D0 it does NOT, by
 *   itself, cause a yield: it cannot express a per-user preference (not knowable
 *   before React) or a route with no panel (one document serves `/login` and
 *   `/cases`).
 *
 *   BE HONEST ABOUT ITS STATUS: nothing in the extension reads it any more. It
 *   is retained because the name is a published cross-repo contract the
 *   Dashboard still renders, and because ADR-018 D0 keeps it deliberately as
 *   the one signal available before React runs. It is INERT until something
 *   consumes it — so do not add behaviour that assumes a reader, and if a
 *   flash-avoidance path is ever built on it, build the reader in the same
 *   change.
 * - Values `"false"`, `"0"` and the empty string do NOT advertise, so a
 *   Dashboard can render the attribute unconditionally and flip its value. Any
 *   other value (`"1"`, a version string) advertises.
 * - YIELDING REQUIRES THE LIVE MESSAGE. The page posts
 *   `DASHBOARD_PANEL_MESSAGE` when a panel is actually mounted and showing, and
 *   `DASHBOARD_PANEL_WITHDRAWN_MESSAGE` when it stops. This costs a brief
 *   window on load where the extension's panel is visible before a yield — the
 *   flash the document_end attribute read existed to avoid. Accepted
 *   deliberately: every ambiguous branch fails towards SHOWING the panel, and a
 *   flash is the mild failure while a dark tab with neither surface is the
 *   severe one.
 * - THE PAGE MUST RE-ASSERT WHENEVER IT IS SHOWN AGAIN, not only on a fresh
 *   mount. The extension releases a tab whose document is being replaced, and
 *   `tabs.onUpdated` reports `status: 'loading'` for things that do NOT create
 *   a new document — a back/forward bfcache restore, an aborted navigation, a
 *   link that turns into a download. In those cases no content script is
 *   re-injected and no React effect re-runs, so a page that only asserts on
 *   mount is released and never yields again for the life of that document.
 *   Posting the assertion from `pageshow` as well as from the panel's mount
 *   closes it. The extension cannot: it has no way to ask a page what it is
 *   currently showing, and the failure direction is the mild one — two panels,
 *   not none — so it does not guess.
 * - A WITHDRAWAL IS NOT OPTIONAL for a page that has asserted. Without it the
 *   advertisement is monotonic — a page could say "I host a panel" and never
 *   "not any more" — which is what made a Dashboard-side preference impossible:
 *   turning the built-in panel off on an already-yielded tab left the user with
 *   NEITHER surface and no way back but navigating off the origin.
 * - The message carries no payload. It is a nudge to re-read the state, and it
 *   is only honoured on a configured Dashboard origin — the content script
 *   validates `event.origin` and the background worker independently re-checks
 *   the browser-supplied sender origin.
 * - The signal is per TAB and does not outlive it. Navigating that tab off a
 *   Dashboard origin restores the extension's panel.
 */

/** Set on `<html>` by a page that renders the panel itself. */
export const DASHBOARD_PANEL_ATTR = 'data-faultmaven-dashboard-panel';

/**
 * Posted by the page to its own window while a built-in panel is showing.
 *
 * THE thing that yields the extension's side panel since ADR-018 D0. The
 * attribute above no longer does.
 */
export const DASHBOARD_PANEL_MESSAGE = 'FM_DASHBOARD_PANEL_AVAILABLE';

/**
 * Its counterpart: the page has stopped showing a built-in panel.
 *
 * Posted when the preference turns the panel off, when a route that mounts no
 * panel takes over, or on sign-out — anything that makes the assertion above
 * untrue without the document going away. The extension releases the tab.
 *
 * SEQUENCING, because this crosses a release boundary in two repositories: an
 * extension that predates this constant ignores the message and leaves the tab
 * YIELDED, which is the dark-tab failure. A Dashboard must therefore not
 * withdraw until extensions in the field understand it — ADR-018 sequences the
 * extension side (row 4) strictly before the Dashboard side (row 5) for exactly
 * this reason.
 */
export const DASHBOARD_PANEL_WITHDRAWN_MESSAGE = 'FM_DASHBOARD_PANEL_WITHDRAWN';

/**
 * Does this document's BUILD claim it can host a panel?
 *
 * ONE predicate, shared, because "what counts as advertising" is the subtle
 * half of the contract — the empty string and `"false"` do not — and two
 * implementations of that rule are two chances to disagree.
 *
 * NOT a yield trigger since ADR-018 D0. It answers "could this deployment host
 * a panel", which is knowable at document_start; whether one is showing *right
 * now, for this user, on this route* is knowable only to a React tree, and
 * travels as `DASHBOARD_PANEL_MESSAGE`. The extension no longer suppresses its
 * panel on the strength of this alone.
 *
 * Read from the DOM at call time rather than cached: a page that mounts its
 * panel after hydration flips the attribute later, and the second read is the
 * one that catches it.
 *
 * Fails closed to `false`: "we could not tell" must mean "keep the extension's
 * panel", never "hide it".
 */
export function dashboardAdvertisesPanel(doc?: Document): boolean {
  try {
    // RESOLVED INSIDE THE TRY. As a default parameter (`doc: Document =
    // document`) the fallback is evaluated BEFORE the try block is entered, so
    // in a context with no DOM the ReferenceError escapes the catch this
    // function relies on to fail closed.
    const value = (doc ?? document).documentElement.getAttribute(DASHBOARD_PANEL_ATTR);
    if (value === null) return false;
    return value !== '' && value !== 'false' && value !== '0';
  } catch {
    // No DOM / non-page context — nothing is advertising.
    return false;
  }
}

/**
 * What the installed extension can DO, space-separated, on `<html>` beside the
 * version (ADR-019 D2).
 *
 * WHY THIS EXISTS AT ALL. The Dashboard deploys in minutes; this extension
 * waits on Chrome Web Store review, so the field always holds Dashboards newer
 * than the extensions talking to them. ADR-018 D0 first answered that with a
 * version floor on the Dashboard side — and a version is a PROXY for a
 * capability, wrong for exactly the builds we develop against: an unpacked
 * build WITH the withdrawal listener still reports its manifest version, so the
 * floor refused the build the feature was being tested with.
 *
 * A TOKEN MEANS "THIS BUILD IMPLEMENTS IT", never "this build is new enough".
 * Forks, nightlies and unpacked builds advertise what they have.
 *
 * A list rather than JSON: it is read on every page load by code that must stay
 * cheap, and a list is the whole of what is needed.
 *
 * READING IT, precisely — the three answers are different and a consumer must
 * keep them apart:
 *
 *   attribute absent     a build from before capabilities. Nothing is claimed;
 *                        fall back to whatever evidence you had before.
 *   attribute empty      this build can do none of the things you asked about.
 *                        AUTHORITATIVE — not the same as absent.
 *   token present        this build implements that behaviour.
 *
 * ⚠️ A TOKEN IS A CLAIM, NOT A PROOF. A build advertising something it does not
 * implement is worse than one that says nothing, because the consumer will
 * trust it. The tokens live here, beside the behaviour they describe, so the
 * two move together — and `presence-marker`'s own test asserts the advertised
 * list against what is actually wired.
 */
/**
 * Set on `<html>` by the extension's auth bridge, valued with its version — the
 * OLDEST half of this handshake, and the last to move here (copilot#261).
 *
 * It lived in `presence-marker.ts` and, separately, in the Dashboard, which is
 * the drift this file exists to end. The failure direction is the worst of the
 * set: rename it on one side only and `installedCopilotVersion()` returns null
 * for every build stamping the new name. For an install with no capability
 * attribute — anything from before capabilities — the Dashboard reads that as
 * "nobody is listening", ASSERTS, and hands a yield to an extension that cannot
 * release it. Tab with neither surface, and nothing red on either side.
 */
export const COPILOT_PRESENCE_ATTR = 'data-faultmaven-copilot';

/**
 * Dispatched on `window` once the bridge has stamped the attributes.
 *
 * Carries no detail: `CustomEvent.detail` can be dropped crossing the
 * content-script → page world boundary, so this only says "look again" and the
 * values are read back off the attributes. That is also why the bridge running
 * at `document_end` is survivable — a consumer that read too early is told to
 * re-read.
 */
export const COPILOT_PRESENCE_EVENT = 'faultmaven-copilot:ready';

export const COPILOT_CAPABILITIES_ATTR = 'data-faultmaven-copilot-capabilities';

/**
 * This build listens for {@link DASHBOARD_PANEL_WITHDRAWN_MESSAGE} and releases
 * a yielded tab.
 *
 * The capability the Dashboard must confirm before it asserts at all: a yield
 * handed to a build that cannot retract it is a tab with neither surface.
 */
export const CAPABILITY_PANEL_WITHDRAW = 'panel-withdraw';

/**
 * A capability token declared in THIS file. Typing the advertised list as
 * `readonly CopilotCapability[]` rather than `readonly string[]` is what stops
 * a hand-written or misspelled token — `'panel-withdrawal'` — from compiling
 * into what a build promises. The failure that prevents is silent on both
 * sides: the consumer simply never finds the token it was looking for and
 * degrades forever, with nothing red anywhere.
 */
export type CopilotCapability = typeof CAPABILITY_PANEL_WITHDRAW;

/**
 * What the installed extension advertises, or `null` if it advertises nothing.
 *
 * THE NAMES WERE NEVER THE SUBTLE PART — the reading rule is, exactly as it is
 * for {@link dashboardAdvertisesPanel}, which exists for this same reason. Two
 * implementations of "absent vs empty vs token", or of how the list is split,
 * are two chances to disagree, and a disagreement here is invisible: one side
 * degrades forever while both stay green.
 *
 * The three answers, kept apart:
 *
 *   `null`   the attribute is absent — a build from before capabilities, or no
 *            extension at all. NOTHING IS CLAIMED: fall back to whatever
 *            evidence you had. Callers must not read this as "cannot".
 *   `[]`     the attribute is present and empty — "this build can do none of
 *            the things you might ask about". AUTHORITATIVE, and deliberately
 *            distinct from `null`.
 *   tokens   each one a promise that the behaviour is compiled into the build.
 *
 * Read from the DOM at call time, never cached: the marker is stamped by a
 * content script at `document_end`, so an early read legitimately sees nothing
 * and a later one is the read that matters.
 *
 * Fails to `null` rather than `[]`: "we could not tell" is the absence of
 * evidence, not evidence of absence.
 */
export function copilotCapabilities(doc?: Document): readonly string[] | null {
  try {
    // Inside the try, for the reason given on dashboardAdvertisesPanel.
    const raw = (doc ?? document).documentElement.getAttribute(COPILOT_CAPABILITIES_ATTR);
    if (raw === null) return null;
    return raw.split(/\s+/).filter(Boolean);
  } catch {
    // No DOM / non-page context — we cannot tell, which is not "cannot do".
    return null;
  }
}

/**
 * Does the installed extension implement `token`?
 *
 * `false` when the attribute is ABSENT as well as when the token is missing, so
 * a caller that wants to fall back to other evidence for a pre-capabilities
 * build must ask {@link copilotCapabilities} for the `null` and decide for
 * itself. That distinction is the whole point of ADR-019 D3, so this function
 * deliberately does not make it for you.
 */
export function copilotImplements(token: string, doc?: Document): boolean {
  return copilotCapabilities(doc)?.includes(token) ?? false;
}
