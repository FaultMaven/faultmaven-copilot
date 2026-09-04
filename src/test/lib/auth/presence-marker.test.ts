import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  announceCopilotPresence,
  COPILOT_PRESENCE_ATTR,
  COPILOT_PRESENCE_EVENT,
  dashboardAdvertisesPanel,
  DASHBOARD_PANEL_ATTR,
  DASHBOARD_PANEL_MESSAGE,
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
