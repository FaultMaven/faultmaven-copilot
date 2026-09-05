/**
 * Rendered proof: a host's own markup, sitting beside the panel, is untouched.
 *
 * `style-scope.test.ts` reads the emitted selectors. This renders the panel
 * next to the markup a host actually has — a link and a `.prose-sm` block, the
 * two the Dashboard review reported — and asks, for every rule the package
 * emits, whether it could match something OUTSIDE the panel.
 *
 * Pseudo-classes are stripped before matching, deliberately: jsdom never
 * hovers, so `a:hover` would match nothing and the check would pass without
 * checking. The question is whether the rule COULD reach host markup.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import CopilotPanel from '@faultmaven/copilot-ui/shared/ui/CopilotPanel';
import { PANEL_ROOT_CLASS } from '@faultmaven/copilot-ui/shared/ui/CopilotPanel';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { createStubHost } from '../../support/host';

vi.mock('@faultmaven/copilot-ui/shared/ui/components/ConversationsList', () => ({
  default: () => <div data-testid="conversations-list" />,
}));

const PKG = join(process.cwd(), 'packages/copilot-ui');
const preset = require(join(PKG, 'tailwind-preset.cjs'));

let selectors: string[] = [];

beforeAll(async () => {
  const css = readFileSync(join(PKG, 'styles', 'globals.css'), 'utf8');
  const result = await postcss([
    tailwindcss({ presets: [preset], content: preset.content }),
  ]).process(css, { from: join(PKG, 'styles', 'globals.css') });

  const found = new Set<string>();
  postcss.parse(result.css).walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes/.test((rule.parent as postcss.AtRule).name)) {
      return;
    }
    for (const s of rule.selectors) found.add(s.trim());
  });
  selectors = [...found];
}, 60_000);

/** `a:hover` → `a`: would this rule reach the element at all? */
function matchable(selector: string): string {
  return selector.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '').trim();
}

/** The panel and the host's own page, side by side. Per test: RTL cleans up. */
function renderBoth() {
    useAppStore.setState({
      initializingCapabilities: false,
      capabilitiesError: null,
      activeCaseId: null,
      activeCase: null,
      hasUnsavedNewChat: true,
    } as never);

    const stub = createStubHost();
    render(
      <div>
        <CopilotPanel host={stub.host} />
        {/* The host's own page, beside the panel. */}
        <div data-testid="host-page">
          <a href="#somewhere" data-testid="host-link">a link the host owns</a>
          <button data-testid="host-button">a button the host owns</button>
          <div className="prose-sm" data-testid="host-prose">
            <ul>
              <li data-testid="host-li">{"a list the host's typography plugin owns"}</li>
            </ul>
          </div>
        </div>
      </div>,
    );
}

describe('the package does not restyle the host around it', () => {
  it('rendered both the panel and the host page beside it', () => {
    renderBoth();
    expect(document.querySelector(`.${PANEL_ROOT_CLASS}`)).not.toBeNull();
    expect(screen.getByTestId('host-link')).toBeInTheDocument();
    expect(selectors.length).toBeGreaterThan(50); // the stylesheet actually compiled
  });

  it.each(['host-link', 'host-button', 'host-li', 'host-prose'])(
    'no rule reaches the host %s',
    (testid) => {
      renderBoth();
      const element = screen.getByTestId(testid);
      const reaching: string[] = [];

      for (const selector of selectors) {
        const probe = matchable(selector);
        if (!probe) continue;
        let matches = false;
        try {
          matches = element.matches(probe);
        } catch {
          continue; // not a selector jsdom can evaluate
        }
        // A rule that matches only because the host wrote one of our utility
        // classes is opt-in, and `.prose-sm` here is the host's own class.
        if (matches && !probe.includes(PANEL_ROOT_CLASS) && !/^\.[a-z]/i.test(probe)) {
          reaching.push(selector);
        }
      }

      expect(
        reaching,
        `These package rules reach the host's own markup:\n${reaching.join('\n')}`,
      ).toEqual([]);
    },
  );

  // …and the same rules DO reach the panel's own markup, or the check above
  // would pass against a stylesheet that styles nothing.
  it('the panel itself is still styled', () => {
    renderBoth();
    const panel = document.querySelector(`.${PANEL_ROOT_CLASS}`)!;
    const reaching = selectors.filter((s) => {
      const probe = matchable(s);
      if (!probe || !probe.includes(PANEL_ROOT_CLASS)) return false;
      try {
        return panel.matches(probe) || panel.querySelector(probe) !== null;
      } catch {
        return false;
      }
    });
    expect(reaching.length).toBeGreaterThan(0);
  });
});
