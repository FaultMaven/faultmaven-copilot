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
} from '../../../extension/auth/presence-marker';

describe('announceCopilotPresence', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(COPILOT_PRESENCE_ATTR);
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
  it('claims panel-withdraw only because the bridge really listens for it', async () => {
    // The proof: the auth bridge's source contains a branch on the withdrawal
    // message and a report to the background. Asserted against the SOURCE
    // rather than a mock, because the thing that must stay true is that the
    // handler exists in the artefact this list ships with.
    const { readFileSync } = await import('node:fs');
    const bridge = readFileSync('src/entrypoints/auth-bridge.content.ts', 'utf8');

    expect(COPILOT_CAPABILITIES).toContain(CAPABILITY_PANEL_WITHDRAW);
    expect(bridge).toContain('DASHBOARD_PANEL_WITHDRAWN_MESSAGE');
    expect(bridge).toContain('dashboardPanelWithdrawn');
  });

  it('advertises nothing it cannot point at', () => {
    // Every token needs a case above. A new one added to the list without one
    // fails here rather than silently becoming a promise nobody checked.
    expect(COPILOT_CAPABILITIES).toEqual([CAPABILITY_PANEL_WITHDRAW]);
  });
});

describe('announceCopilotPresence', () => {
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

  it('writes CAPABILITIES BEFORE the version', () => {
    // A consumer checks capabilities before presence (ADR-019 D3), so that a
    // build mid-write is never mistaken for "no extension" — which means
    // ASSERT, and an assertion to a build that cannot withdraw is the dark tab.
    // Written the other way round there is a window where the version is
    // readable and the list is not, which reads as exactly that old build.
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
      expect(order.indexOf(COPILOT_CAPABILITIES_ATTR)).toBeLessThan(
        order.indexOf(COPILOT_PRESENCE_ATTR),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
