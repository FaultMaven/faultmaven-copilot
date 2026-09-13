import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  announceCopilotPresence,
  COPILOT_PRESENCE_ATTR,
  COPILOT_PRESENCE_EVENT,
  dashboardAdvertisesPanel,
  DASHBOARD_PANEL_ATTR,
  DASHBOARD_PANEL_MESSAGE,
  CAPABILITY_PANEL_WITHDRAW,
  COPILOT_CAPABILITIES,
  COPILOT_CAPABILITIES_ATTR,
  copilotCapabilities,
  copilotImplements,
} from '../../../extension/auth/presence-marker';

describe('announceCopilotPresence', () => {
  afterEach(() => {
    // BOTH attributes. This block's tests stamp the capability list too, and
    // leaving it on <html> leaks into every later block in the file — today
    // invisible only because the next block happens to re-stamp it, which makes
    // any future "announces nothing" test pass or fail on test ORDER.
    document.documentElement.removeAttribute(COPILOT_PRESENCE_ATTR);
    document.documentElement.removeAttribute(COPILOT_CAPABILITIES_ATTR);
    vi.restoreAllMocks();
  });

  it('marks <html> with the version (the dashboard reads this)', () => {
    announceCopilotPresence('1.2.3');
    expect(document.documentElement.getAttribute(COPILOT_PRESENCE_ATTR)).toBe('1.2.3');
  });

  it('dispatches the readiness event', () => {
    const listener = vi.fn();
    window.addEventListener(COPILOT_PRESENCE_EVENT, listener);
    announceCopilotPresence('1.2.3');
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(COPILOT_PRESENCE_EVENT, listener);
  });
});

/**
 * The other half of the same handshake: the Dashboard telling the copilot that
 * IT hosts the built-in panel. faultmaven-dashboard#120 implements the page
 * side against these exact names, so they are pinned here — a rename that only
 * lands in this repo would silently stop every Dashboard advertising, and the
 * failure would look like "the panel just stopped yielding".
 */
describe('the dashboard built-in panel contract', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(DASHBOARD_PANEL_ATTR);
  });

  it('names the attribute and message the dashboard implements against', () => {
    expect(DASHBOARD_PANEL_ATTR).toBe('data-faultmaven-dashboard-panel');
    expect(DASHBOARD_PANEL_MESSAGE).toBe('FM_DASHBOARD_PANEL_AVAILABLE');
  });

  it('does not advertise when the attribute is absent', () => {
    // Silence is the safe answer: a Dashboard build with no panel of its own
    // says nothing, and the extension keeps showing its panel.
    expect(dashboardAdvertisesPanel()).toBe(false);
  });

  it.each(['1', 'true', '1.0.4'])('advertises for the value %o', (value) => {
    document.documentElement.setAttribute(DASHBOARD_PANEL_ATTR, value);
    expect(dashboardAdvertisesPanel()).toBe(true);
  });

  it.each(['', 'false', '0'])('does not advertise for the value %o', (value) => {
    // So a Dashboard can render the attribute unconditionally and flip its
    // value rather than conditionally emitting the attribute at all.
    document.documentElement.setAttribute(DASHBOARD_PANEL_ATTR, value);
    expect(dashboardAdvertisesPanel()).toBe(false);
  });
});

/**
 * What this build ADVERTISES must be what it actually does (ADR-019 D2).
 *
 * A token is a claim, not a proof: a build advertising a behaviour it does not
 * implement is worse than one that says nothing, because the Dashboard will
 * trust it and hand over a yield the build cannot retract — a tab with neither
 * surface. Nothing in the type system ties the list to the handlers, so this
 * does.
 */
describe('the advertised capability list', () => {
  /**
   * Read a source file RELATIVE TO THIS TEST, not to `process.cwd()`.
   *
   * `readFileSync('src/…')` resolves against the working directory, which
   * vitest never sets — so an IDE runner, `vitest --dir`, or a run from inside
   * one of the `.worktrees/` copies the vitest config explicitly anticipates
   * threw ENOENT instead of reporting the assertion.
   */
  const readSource = async (relativeToRepoSrc: string): Promise<string> => {
    const { readFileSync } = await import('node:fs');
    // A URL object directly — `readFileSync` accepts one, so this needs no
    // `fileURLToPath` and no assumption about `node:url`'s interop shape.
    return readFileSync(new URL('../../../' + relativeToRepoSrc, import.meta.url), 'utf8');
  };

  it('claims panel-withdraw only because BOTH halves of it are wired', async () => {
    // The capability is a round trip, and an earlier version of this test
    // checked neither half properly: `toContain('DASHBOARD_PANEL_WITHDRAWN_MESSAGE')`
    // was satisfied by the IMPORT LINE at the top of the bridge, so deleting
    // the entire handler left it green — and the half that actually releases
    // the tab lives in background.ts, which it never opened at all.
    //
    // Both assertions below require the identifier IN A POSITION THAT DOES
    // SOMETHING: a comparison against the incoming message, and a call that
    // releases the tab. An import cannot satisfy either.
    const bridge = await readSource('entrypoints/auth-bridge.content.ts');
    const background = await readSource('entrypoints/background.ts');

    expect(COPILOT_CAPABILITIES).toContain(CAPABILITY_PANEL_WITHDRAW);

    // 1. The page's withdrawal is recognised…
    expect(bridge).toMatch(/===\s*DASHBOARD_PANEL_WITHDRAWN_MESSAGE/);
    // …and reported to the background.
    expect(bridge).toMatch(/action:\s*['"]dashboardPanelWithdrawn['"]/);
    // 2. The background RELEASES the yielded tab on that report. Without this
    //    the extension advertises a retraction it never performs, the Dashboard
    //    trusts the token and asserts, and the tab ends with neither surface.
    expect(background).toMatch(/['"]dashboardPanelWithdrawn['"]/);
    expect(background).toMatch(/releaseSidePanelForTab\(/);
  });

  it('proves those greps can fail', async () => {
    // A source-text assertion that cannot fail is the defect this block was
    // just fixed for, so the patterns are shown rejecting a file that merely
    // IMPORTS the names.
    const importOnly = "import { DASHBOARD_PANEL_WITHDRAWN_MESSAGE } from './contract';\n";
    expect(/===\s*DASHBOARD_PANEL_WITHDRAWN_MESSAGE/.test(importOnly)).toBe(false);
    expect(/action:\s*['"]dashboardPanelWithdrawn['"]/.test(importOnly)).toBe(false);
  });

  it('advertises nothing it cannot point at', () => {
    // Every token needs a case above. A new one added to the list without one
    // fails here rather than silently becoming a promise nobody checked.
    expect(COPILOT_CAPABILITIES).toEqual([CAPABILITY_PANEL_WITHDRAW]);
  });

  it('pins the two names the Dashboard implements against', () => {
    // Same reason DASHBOARD_PANEL_ATTR is pinned above: a rename that lands
    // only in this repo leaves the Dashboard reading an attribute nobody
    // writes, and nothing is red on either side.
    expect(COPILOT_CAPABILITIES_ATTR).toBe('data-faultmaven-copilot-capabilities');
    expect(CAPABILITY_PANEL_WITHDRAW).toBe('panel-withdraw');
  });
});

describe('the capability READER, which both repositories share', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(COPILOT_CAPABILITIES_ATTR);
  });

  it('answers null when the attribute is absent — "it never said"', () => {
    // Not `[]`. Absent is a build from before capabilities, and a consumer must
    // be able to fall back to whatever evidence it had.
    expect(copilotCapabilities()).toBeNull();
  });

  it('answers [] when the attribute is empty — "it can do none of these"', () => {
    document.documentElement.setAttribute(COPILOT_CAPABILITIES_ATTR, '');
    expect(copilotCapabilities()).toEqual([]);
  });

  it('splits on any run of whitespace and drops the gaps', () => {
    document.documentElement.setAttribute(COPILOT_CAPABILITIES_ATTR, '  a   b \n c  ');
    expect(copilotCapabilities()).toEqual(['a', 'b', 'c']);
  });

  it('reads the DOM at call time, so a later stamp is seen', () => {
    expect(copilotImplements(CAPABILITY_PANEL_WITHDRAW)).toBe(false);
    announceCopilotPresence('9.9.9');
    expect(copilotImplements(CAPABILITY_PANEL_WITHDRAW)).toBe(true);
  });

  it('reports false for a token an advertising build omits', () => {
    document.documentElement.setAttribute(COPILOT_CAPABILITIES_ATTR, 'something-else');
    expect(copilotImplements(CAPABILITY_PANEL_WITHDRAW)).toBe(false);
  });
});

describe('announceCopilotPresence writes both attributes', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(COPILOT_PRESENCE_ATTR);
    document.documentElement.removeAttribute(COPILOT_CAPABILITIES_ATTR);
  });

  it('stamps the capability list and the version', () => {
    announceCopilotPresence('9.9.9');

    expect(document.documentElement.getAttribute(COPILOT_CAPABILITIES_ATTR)).toBe(
      CAPABILITY_PANEL_WITHDRAW,
    );
    expect(document.documentElement.getAttribute(COPILOT_PRESENCE_ATTR)).toBe('9.9.9');
  });

  it('writes capabilities before the version, and writes BOTH', () => {
    // The `toBeLessThan` alone was vacuous in the direction that matters:
    // delete the capabilities write and `indexOf` returns -1, so `-1 < 0`
    // passed while the build advertised nothing. Both writes are asserted
    // present before their order is compared.
    //
    // The ORDER itself is a convention, not a race fix — the two statements run
    // in one synchronous task, so no consumer can observe a state between them.
    // It is pinned because it is free and stays correct if a suspension point
    // is ever introduced between the writes.
    const order: string[] = [];
    const real = document.documentElement.setAttribute.bind(document.documentElement);
    const spy = vi
      .spyOn(document.documentElement, 'setAttribute')
      .mockImplementation((name: string, value: string) => {
        order.push(name);
        real(name, value);
      });

    try {
      announceCopilotPresence('9.9.9');
      expect(order).toEqual([COPILOT_CAPABILITIES_ATTR, COPILOT_PRESENCE_ATTR]);
    } finally {
      spy.mockRestore();
    }
  });
});
