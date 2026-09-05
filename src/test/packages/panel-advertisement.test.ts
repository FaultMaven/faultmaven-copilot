/**
 * The advertisement contract has ONE definition.
 *
 * A page that renders the Copilot panel itself says so, and the extension's
 * side panel stands down on that tab. Three names carry it and both
 * repositories need all three — so a copy in either is a copy that can drift
 * while both sides stay green, and the user gets one panel or two depending on
 * which copy was right.
 *
 * The subtle half is the predicate: `""` and `"false"` do NOT advertise, so a
 * page can render the attribute unconditionally and flip its value.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DASHBOARD_PANEL_ATTR,
  DASHBOARD_PANEL_MESSAGE,
  dashboardAdvertisesPanel,
} from '@faultmaven/copilot-ui';
import * as presenceMarker from '../../extension/auth/presence-marker';

describe('the advertisement contract', () => {
  it('is exported from the package entry', () => {
    expect(DASHBOARD_PANEL_ATTR).toBe('data-faultmaven-dashboard-panel');
    expect(DASHBOARD_PANEL_MESSAGE).toBe('FM_DASHBOARD_PANEL_AVAILABLE');
    expect(typeof dashboardAdvertisesPanel).toBe('function');
  });

  // Identity, not equality: two modules exporting the same string literal is
  // exactly the drift this is meant to remove.
  it('is the SAME definition the extension uses', () => {
    expect(presenceMarker.DASHBOARD_PANEL_ATTR).toBe(DASHBOARD_PANEL_ATTR);
    expect(presenceMarker.DASHBOARD_PANEL_MESSAGE).toBe(DASHBOARD_PANEL_MESSAGE);
    expect(presenceMarker.dashboardAdvertisesPanel).toBe(dashboardAdvertisesPanel);
  });

  it('the extension defines none of it itself', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/extension/auth/presence-marker.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');

    for (const literal of ['data-faultmaven-dashboard-panel', 'FM_DASHBOARD_PANEL_AVAILABLE']) {
      expect(
        source.includes(literal),
        `the extension spells ${literal} itself; it should import it`,
      ).toBe(false);
    }
  });

  describe('what counts as advertising', () => {
    const withAttribute = (value: string | null): Document => {
      const doc = document.implementation.createHTMLDocument('t');
      if (value !== null) doc.documentElement.setAttribute(DASHBOARD_PANEL_ATTR, value);
      return doc;
    };

    it.each([['1'], ['true'], ['2.1.0']])('%s advertises', (value) => {
      expect(dashboardAdvertisesPanel(withAttribute(value))).toBe(true);
    });

    // The half that lets a page render the attribute unconditionally.
    it.each([[''], ['false'], ['0']])('%s does NOT advertise', (value) => {
      expect(dashboardAdvertisesPanel(withAttribute(value))).toBe(false);
    });

    it('an absent attribute does not advertise', () => {
      expect(dashboardAdvertisesPanel(withAttribute(null))).toBe(false);
    });

    // "We could not tell" must mean "keep the extension's panel".
    it('fails closed when there is no DOM to read', () => {
      const broken = {
        get documentElement(): HTMLElement {
          throw new Error('no DOM');
        },
      } as unknown as Document;

      expect(dashboardAdvertisesPanel(broken)).toBe(false);
    });
  });
});
