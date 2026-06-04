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
 * the docstring on ``DispositionEligibility`` in src/types/case.ts.
 *
 * Matrix coverage (backend emits per derive_disposition_eligibility):
 *
 * | Case state                                | resolved              | closed                | Dropdown shows           |
 * |-------------------------------------------|-----------------------|-----------------------|--------------------------|
 * | INQUIRY                                   | not_eligible          | ready                 | Investigating + Closed   |
 * | INVESTIGATING + too thin (SUGGEST_CLOSE)  | not_eligible          | ready                 | Closed only              |
 * | INVESTIGATING + partial (NEEDS_INFO)      | needs_info            | ready                 | Closed only              |
 * | INVESTIGATING + resolution-grade          | ready                 | suggests_alternative  | Resolved only            |
 * | INVESTIGATING + both ready (hypothetical) | ready                 | ready                 | Resolved + Closed        |
 * | Terminal (RESOLVED / CLOSED)              | not_eligible          | not_eligible          | (none)                   |
 *
 * Plus the legacy fallback path (no ``disposition_eligibility`` on the
 * response) which must remain non-breaking for older cases.
 */

import { describe, it, expect } from 'vitest';
import { getCaseActionOptions } from '../../shared/ui/components/case-header/HeaderSummary';
import type { CaseUIResponse } from '../../types/case';

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
    it('always offers the investigating transition (phase change, not gated)', () => {
      const opts = getCaseActionOptions(
        inquiry({
          disposition_eligibility: { resolved: 'not_eligible', closed: 'ready' },
        }),
      );
      expect(opts.some((o) => o.state === 'investigating')).toBe(true);
      // The investigating transition is not gated by disposition_eligibility;
      // its eligibility slot must be null.
      const inv = opts.find((o) => o.state === 'investigating');
      expect(inv?.eligibility).toBeNull();
    });

    it('offers closed:ready alongside investigating in the default INQUIRY shape', () => {
      const opts = getCaseActionOptions(
        inquiry({
          disposition_eligibility: { resolved: 'not_eligible', closed: 'ready' },
        }),
      );
      expect(opts).toContainEqual({ state: 'investigating', eligibility: null });
      expect(opts).toContainEqual({ state: 'closed', eligibility: 'ready' });
      // resolved is not_eligible from INQUIRY (structurally invalid) — drop it.
      expect(opts.some((o) => o.state === 'resolved')).toBe(false);
    });

    it('drops closed when not_eligible (defensive — backend should not emit this for INQUIRY today)', () => {
      const opts = getCaseActionOptions(
        inquiry({
          disposition_eligibility: {
            resolved: 'not_eligible',
            closed: 'not_eligible',
          },
        }),
      );
      // Investigating remains, closed dropped.
      expect(opts).toEqual([{ state: 'investigating', eligibility: null }]);
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

    it('resolution-grade case (resolved:ready, closed:suggests_alternative) hides Close — only Resolve shows', () => {
      // ``suggests_alternative`` is hidden: clicking Close here would pivot
      // to RESOLVED at confirmation time (the engine's SUGGEST_RESOLVE
      // behaviour). Don't waste the user's click — show Resolve directly,
      // which is the engine's intended outcome for a resolution-grade case.
      const opts = getCaseActionOptions(
        investigating({
          disposition_eligibility: {
            resolved: 'ready',
            closed: 'suggests_alternative',
          },
        }),
      );
      expect(opts).toEqual([{ state: 'resolved', eligibility: 'ready' }]);
    });

    it('both ready (hypothetical — backend never co-emits this today) shows both', () => {
      // Defensive: if backend ever decouples the readiness conditions and
      // emits ``{resolved: ready, closed: ready}``, both options surface.
      const opts = getCaseActionOptions(
        investigating({
          disposition_eligibility: { resolved: 'ready', closed: 'ready' },
        }),
      );
      expect(opts).toEqual([
        { state: 'resolved', eligibility: 'ready' },
        { state: 'closed', eligibility: 'ready' },
      ]);
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
    it('falls back to valid_next_states when eligibility is absent', () => {
      const opts = getCaseActionOptions(
        investigating({
          valid_next_states: ['resolved', 'closed'],
        } as unknown as Partial<CaseUIResponse>),
      );
      // All eligibility null on the fallback path — no verdict info available.
      // We surface what the action graph allows so the dropdown isn't empty
      // for cases that pre-date the disposition_eligibility column.
      expect(opts).toEqual([
        { state: 'resolved', eligibility: null },
        { state: 'closed', eligibility: null },
      ]);
    });

    it('falls back to hardcoded defaults when both eligibility and valid_next_states are absent', () => {
      const opts = getCaseActionOptions(investigating());
      // Last-resort safety net — keep the dropdown non-empty.
      expect(opts).toEqual([
        { state: 'resolved', eligibility: null },
        { state: 'closed', eligibility: null },
      ]);
    });

    it('INQUIRY fallback always retains the investigating transition', () => {
      const opts = getCaseActionOptions(inquiry());
      expect(opts.some((o) => o.state === 'investigating')).toBe(true);
    });
  });
});
