/**
 * Unit tests for ``getCaseActionOptions`` — the pure function that
 * drives the case-action dropdown render in HeaderSummary.
 *
 * Design rule the tests pin: the dropdown surfaces *only* ``ready``
 * disposition verdicts. What each verdict means is its enum's
 * ``x-enum-descriptions`` in the pinned contract (``CloseEligibility``,
 * ``ResolveEligibility``); these tests do not restate it.
 *
 * ``resolved`` NEVER renders a control. It is earned by a confirmed root-cause
 * elimination and the agent proposes it through the confirm/decline pair; the
 * backend refuses a request for it. The key is still published — it is
 * FaultMaven's own readiness verdict — it is simply not a button.
 *
 * The verdict matrix is keyed on the published enums (``RESOLVE_VERDICTS``,
 * ``CLOSE_RENDERS`` below), so it runs every combination the contract allows,
 * and a value a later pin adds or drops fails ``pnpm compile`` until the
 * matrix says how it renders.
 *
 * Plus the legacy fallback path (no ``disposition_eligibility`` on the
 * response) which must remain non-breaking for older cases.
 */

import { describe, it, expect } from 'vitest';
import { getCaseActionOptions } from '@faultmaven/copilot-ui/shared/ui/components/case-header/HeaderSummary';
import type {
  CaseUIResponse,
  CloseEligibility,
  ResolveEligibility,
} from '@faultmaven/copilot-ui/types/case';

// Small helpers to build minimal CaseUIResponse stubs. Only the fields
// getCaseActionOptions reads are populated; everything else is irrelevant
// for these tests. Casts are used to keep the fixtures terse — the
// function is shape-driven, not validator-driven.
function inquiry(extras: Partial<CaseUIResponse> = {}): CaseUIResponse {
  return { state: 'inquiry', ...extras } as CaseUIResponse;
}
function investigating(extras: Partial<CaseUIResponse> = {}): CaseUIResponse {
  return { state: 'investigating', ...extras } as CaseUIResponse;
}
function resolved(extras: Partial<CaseUIResponse> = {}): CaseUIResponse {
  return { state: 'resolved', ...extras } as CaseUIResponse;
}
function closed(extras: Partial<CaseUIResponse> = {}): CaseUIResponse {
  return { state: 'closed', ...extras } as CaseUIResponse;
}

// The verdict matrix, keyed on the published enums. Each `Record` must name
// every value of its enum and no other, so a pin that changes either enum fails
// `pnpm compile` here. The boolean is the client's rule, not a meaning: Close
// renders on `closed === 'ready'` and on nothing else.
const RESOLVE_VERDICTS: Record<ResolveEligibility, true> = {
  ready: true,
  needs_info: true,
  not_eligible: true,
};
const CLOSE_RENDERS: Record<CloseEligibility, boolean> = {
  ready: true,
  suggests_alternative: false,
  not_eligible: false,
};
const VERDICT_MATRIX = (Object.keys(RESOLVE_VERDICTS) as ResolveEligibility[]).flatMap(
  (resolved) =>
    (Object.keys(CLOSE_RENDERS) as CloseEligibility[]).map((closed) => ({
      resolved,
      closed,
      renders: CLOSE_RENDERS[closed],
    })),
);

describe('getCaseActionOptions', () => {
  describe('every verdict combination the published enums allow', () => {
    it.each(VERDICT_MATRIX)(
      'resolved:$resolved, closed:$closed → Close shown: $renders',
      ({ resolved: r, closed: c, renders }) => {
        const disposition_eligibility = { resolved: r, closed: c };
        const active = renders ? [{ state: 'closed', eligibility: 'ready' }] : [];
        expect(getCaseActionOptions(inquiry({ disposition_eligibility }))).toEqual(active);
        expect(getCaseActionOptions(investigating({ disposition_eligibility }))).toEqual(active);
        // Terminal states offer nothing, whatever the verdicts say.
        expect(getCaseActionOptions(resolved({ disposition_eligibility }))).toEqual([]);
        expect(getCaseActionOptions(closed({ disposition_eligibility }))).toEqual([]);
      },
    );
  });

  describe('INQUIRY', () => {
    it('never offers investigating — it is earned, not picked', () => {
      const opts = getCaseActionOptions(
        inquiry({
          disposition_eligibility: { resolved: 'not_eligible', closed: 'ready' },
        }),
      );
      // This entry used to be injected unconditionally with eligibility:null,
      // which made the one transition with a real content precondition the one
      // exempt from gating — and the backend could not withdraw it, because
      // the entry was ours. INVESTIGATING is reached by confirming a problem
      // statement (Gate 1), so it is not a menu action at all.
      expect(opts.some((o) => o.state === 'investigating')).toBe(false);
    });

    it('offers closed:ready in the default INQUIRY shape', () => {
      const opts = getCaseActionOptions(
        inquiry({
          disposition_eligibility: { resolved: 'not_eligible', closed: 'ready' },
        }),
      );
      expect(opts).toEqual([{ state: 'closed', eligibility: 'ready' }]);
      // resolved is not_eligible from INQUIRY (structurally invalid) — drop it.
      expect(opts.some((o) => o.state === 'resolved')).toBe(false);
    });

    it('drops closed when not_eligible, leaving no actions', () => {
      const opts = getCaseActionOptions(
        inquiry({
          disposition_eligibility: {
            resolved: 'not_eligible',
            closed: 'not_eligible',
          },
        }),
      );
      // Empty is the honest answer: an INQUIRY case whose close is not ready
      // has no user action available. It previously showed Investigating,
      // which the engine would have refused.
      expect(opts).toEqual([]);
    });

    it('filters investigating out of valid_next_states from an older backend', () => {
      const opts = getCaseActionOptions(
        inquiry({
          valid_next_states: ['investigating', 'closed'],
        } as Partial<CaseUIResponse>),
      );
      expect(opts).toEqual([{ state: 'closed', eligibility: null }]);
    });
  });

  describe('INVESTIGATING — every verdict combination', () => {
    it('thin case (resolved:not_eligible, closed:ready) shows Close only', () => {
      const opts = getCaseActionOptions(
        investigating({
          disposition_eligibility: { resolved: 'not_eligible', closed: 'ready' },
        }),
      );
      expect(opts).toEqual([{ state: 'closed', eligibility: 'ready' }]);
    });

    it('partial case (resolved:needs_info, closed:ready) hides Resolve — only Close shows', () => {
      // ``needs_info`` is hidden: clicking Resolve here would dead-end on a
      // readiness prompt asking for missing info. The agent surfaces what's
      // missing through the conversation; the dropdown shouldn't offer a
      // dead-end click.
      const opts = getCaseActionOptions(
        investigating({
          disposition_eligibility: { resolved: 'needs_info', closed: 'ready' },
        }),
      );
      expect(opts).toEqual([{ state: 'closed', eligibility: 'ready' }]);
    });

    it('resolution-grade case (resolved:ready, closed:suggests_alternative) shows NOTHING', () => {
      // The empty menu is correct, not a gap. On a resolvable case
      // ``suggests_alternative`` is set while no resolve decline stands — when
      // INV-37 pivots every close back to a resolve proposal, so a Close
      // control could only ever produce "shall I mark this resolved?" — and
      // while a resolve proposal is pending (as when the user asks for it).
      // Resolve is not a control at all; the agent is offering it in chat.
      const opts = getCaseActionOptions(
        investigating({
          disposition_eligibility: {
            resolved: 'ready',
            closed: 'suggests_alternative',
          },
        }),
      );
      expect(opts).toEqual([]);
    });

    it('resolution READY with a resolve decline standing (resolved:ready, closed:ready) shows Close only', () => {
      // The decline state, which core emits since contract 14.8.0 (fm#2360):
      // the user declined the resolution, so ``closed`` reads ``ready`` and
      // Close closes the case with ``resolution_declined``. It is also the one
      // shape where an implementation that iterates the eligibility map
      // instead of the allowlist would leak Resolve back in.
      const opts = getCaseActionOptions(
        investigating({
          disposition_eligibility: { resolved: 'ready', closed: 'ready' },
        }),
      );
      expect(opts).toEqual([{ state: 'closed', eligibility: 'ready' }]);
    });

    it('hides both when each side is non-ready (resolved:needs_info, closed:suggests_alternative)', () => {
      // Pin the rule explicitly: only ``ready`` items render, so the dropdown
      // is empty rather than offering dead-end clicks.
      const opts = getCaseActionOptions(
        investigating({
          disposition_eligibility: {
            resolved: 'needs_info',
            closed: 'suggests_alternative',
          },
        }),
      );
      expect(opts).toEqual([]);
    });
  });

  describe('Terminal states', () => {
    it('returns no actions for RESOLVED regardless of eligibility map', () => {
      expect(
        getCaseActionOptions(
          resolved({
            disposition_eligibility: {
              resolved: 'not_eligible',
              closed: 'not_eligible',
            },
          }),
        ),
      ).toEqual([]);
    });

    it('returns no actions for CLOSED regardless of eligibility map', () => {
      expect(
        getCaseActionOptions(
          closed({
            disposition_eligibility: {
              resolved: 'not_eligible',
              closed: 'not_eligible',
            },
          }),
        ),
      ).toEqual([]);
    });
  });

  describe('Legacy fallback (no disposition_eligibility)', () => {
    it('an INQUIRY fallback never surfaces resolved either', () => {
      // The gap this file missed. The INQUIRY fallback filtered only
      // ``investigating``; a pre-v3 backend lists ``resolved`` for INQUIRY
      // too, and that rendered a control whose modal has no copy and whose
      // submit is dropped on the floor — the user sees an empty quoted block,
      // clicks Continue, and nothing enters the transcript.
      //
      // Not fixed by adding a second exclusion: ``getCaseActionOptions`` now
      // intersects with ``ALLOWED_ACTIONS``, so an un-excluded state cannot
      // leak through any path.
      const opts = getCaseActionOptions({
        state: 'inquiry',
        valid_next_states: ['investigating', 'resolved', 'closed'],
      } as unknown as CaseUIResponse);
      expect(opts).toEqual([{ state: 'closed', eligibility: null }]);
    });

    it('falls back to valid_next_states when eligibility is absent', () => {
      // ``['resolved','closed']`` is a PRE-9.0.0 server; the adopted contract
      // lists only ``closed``. Kept deliberately — the fallback exists for
      // exactly those servers — and labelled so it is not read as current.
      const opts = getCaseActionOptions(
        investigating({
          valid_next_states: ['resolved', 'closed'],
        } as unknown as Partial<CaseUIResponse>),
      );
      // All eligibility null on the fallback path — no verdict info available.
      // We surface what the action graph allows so the dropdown isn't empty
      // for cases that pre-date the disposition_eligibility column — but
      // ``resolved`` is filtered even here. An older backend still lists it,
      // and this fallback offering it UNGATED was the mirror of the
      // ``investigating`` entry #1608 removed for the same reason.
      expect(opts).toEqual([{ state: 'closed', eligibility: null }]);
    });

    it('falls back to hardcoded defaults when both eligibility and valid_next_states are absent', () => {
      const opts = getCaseActionOptions(investigating());
      // Degraded-API fallback: no verdicts and no state list, so fall back to
      // what the action table permits.
      //
      // ‼ NOT an invariant that the menu is non-empty — the JSDoc on
      // `getCaseActionOptions` revokes that promise explicitly, and on a
      // resolution-grade case an empty menu is the intended rendering. This
      // comment used to assert the opposite, which made the KNOWN ASYMMETRY
      // upstream (a `suggests_alternative` case still rendering Close through
      // the unverdicted fallback) look like a regression to anyone tightening
      // it: the fix would fail a test whose comment called the gap the rule.
      expect(opts).toEqual([{ state: 'closed', eligibility: null }]);
    });

    it('INQUIRY fallback offers close only — never investigating', () => {
      // Last-resort path when the API returns neither disposition_eligibility
      // nor valid_next_states. Close is always a valid disposition, so the
      // menu is not empty; investigating is never a menu action.
      const opts = getCaseActionOptions(inquiry());
      expect(opts).toEqual([{ state: 'closed', eligibility: null }]);
    });
  });
});
