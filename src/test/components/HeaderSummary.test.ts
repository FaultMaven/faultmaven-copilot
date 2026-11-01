/**
 * Unit tests for ``getCaseActionOptions`` — the pure function that
 * drives the case-action dropdown render in HeaderSummary.
 *
 * Design rule the tests pin: the dropdown surfaces *only* ``ready``
 * disposition verdicts. What each verdict means is the ``x-enum-descriptions``
 * of ``CloseEligibility`` and ``ResolveEligibility`` in
 * ``docs/reference/api/openapi.json`` of ``FaultMaven/faultmaven`` at the
 * ``ref`` pinned in ``api-contract.pin.json`` (openapi-typescript drops them
 * from ``api.generated.ts``); these tests do not restate it.
 *
 * ``resolved`` NEVER renders a control: RESOLVED is not user-selectable (the
 * backend refuses a request for it since contract 9.0.0), so only the
 * ``closed`` verdict can show one.
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

    it('filters investigating out of valid_next_states from an older backend', () => {
      const opts = getCaseActionOptions(
        inquiry({
          valid_next_states: ['investigating', 'closed'],
        } as Partial<CaseUIResponse>),
      );
      expect(opts).toEqual([{ state: 'closed', eligibility: null }]);
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
      // `getCaseActionOptions` revokes that promise explicitly: whenever
      // `closed` is not `ready` the menu is empty. This comment used to assert
      // the opposite, which made the KNOWN ASYMMETRY upstream (a case served
      // without verdicts still renders Close where a verdict could have hidden
      // it) look like a regression to anyone tightening it: the fix would fail
      // a test whose comment called the gap the rule.
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
