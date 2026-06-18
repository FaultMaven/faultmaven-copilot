import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  announceCopilotPresence,
  COPILOT_PRESENCE_ATTR,
  COPILOT_PRESENCE_EVENT,
} from '../../../lib/auth/presence-marker';

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
