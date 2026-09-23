/**
 * Unit tests for ``getCaseActionOptions`` — the pure function that
 * drives the case-action dropdown render in HeaderSummary.
 *
 * Design rule the tests pin: the dropdown surfaces *only* ``ready``
 * disposition verdicts. ``needs_info``, ``suggests_alternative``, and
 * ``not_eligible`` are all hidden — the engine's action-time path
 * (both dropdown and natural language) either asks for missing info
 * or pivots to the other disposition, so a clickable menu entry for
 * those verdicts would be a dead-end. See HeaderSummary JSDoc and
 * the docstring on ``DispositionEligibility`` in packages/copilot-ui/types/case.ts.
 *
 * Matrix coverage (backend emits per derive_disposition_eligibility):
 *
 * ``resolved`` NEVER renders a control. It is earned by a confirmed root-cause
 * elimination and the agent proposes it through the confirm/decline pair; the
 * backend refuses a request for it. The key is still published — it is
 * FaultMaven's own readiness verdict — it is simply not a button.
 *
 * | Case state                                | resolved              | closed                | Dropdown shows           |
 * |-------------------------------------------|-----------------------|-----------------------|--------------------------|
 * | INQUIRY                                   | not_eligible          | ready                 | Closed only              |
 * | INVESTIGATING + too thin (SUGGEST_CLOSE)  | not_eligible          | ready                 | Closed only              |
 * | INVESTIGATING + partial (NEEDS_INFO)      | needs_info            | ready                 | Closed only              |
 * | INVESTIGATING + resolution-grade          | ready                 | suggests_alternative  | (none)                   |
 * | Terminal (RESOLVED / CLOSED)              | not_eligible          | not_eligible          | (none)                   |
 *
 * Plus the legacy fallback path (no ``disposition_eligibility`` on the
 * response) which must remain non-breaking for older cases.
 */

import { describe, it, expect } from 'vitest';
import { getCaseActionOptions } from '@faultmaven/copilot-ui/shared/ui/components/case-header/HeaderSummary';
import type { CaseUIResponse } from '@faultmaven/copilot-ui/types/case';

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

describe('getCaseActionOptions', () => {
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
      // The empty menu is correct, not a gap. ``suggests_alternative`` is set
      // exactly when a qualifying causal-absence row is on the case — which is
      // exactly when INV-37 pivots every close back to a resolve proposal. So
      // a Close control here could only ever produce "shall I mark this
      // resolved?", and Resolve is not a control at all. The case has one
      // terminal destination and the agent is already offering it in chat.
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

    it('resolved:ready never renders a control (hypothetical pair — see note)', () => {
      // ‼ The backend cannot emit this combination today:
      // ``assess_closure_readiness`` returns SUGGEST_RESOLVE iff
      // ``_has_causal_absence``, which is the same predicate that makes
      // resolution READY — so ``closed: 'ready'`` and ``resolved: 'ready'``
      // are mutually exclusive. Kept as a DEFENSIVE pin, labelled as such,
      // because it is the one shape where an implementation that iterates the
      // eligibility map instead of the allowlist would leak Resolve back in.
      // An earlier version of this test dropped the caveat and read as live
      // coverage of a reachable state.
      const opts = getCaseActionOptions(
        investigating({
          disposition_eligibility: { resolved: 'ready', closed: 'ready' },
        }),
      );
      expect(opts).toEqual([{ state: 'closed', eligibility: 'ready' }]);
    });

    it('hides both when each side is non-ready (hypothetical — degenerate state)', () => {
      // Pin the rule explicitly: only ``ready`` items render. If the backend
      // ever produced this combination, the dropdown would be empty rather
      // than offer dead-end clicks.
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
