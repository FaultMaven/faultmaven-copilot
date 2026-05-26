/**
 * Unit tests for ``getCaseActionOptions`` — the pure function that
 * drives the case-action dropdown render in HeaderSummary.
 *
 * Matrix coverage (backend PR #373 — see derive_disposition_eligibility):
 *
 * | Case state                                | resolved              | closed                |
 * |-------------------------------------------|-----------------------|-----------------------|
 * | INQUIRY                                   | not_eligible          | ready                 |
 * | INVESTIGATING + too thin (SUGGEST_CLOSE)  | not_eligible          | ready                 |
 * | INVESTIGATING + partial (NEEDS_INFO)      | needs_info            | ready                 |
 * | INVESTIGATING + root cause + solution     | ready                 | suggests_alternative  |
 * | INVESTIGATING + ready                     | ready                 | ready                 |
 * | Terminal (RESOLVED / CLOSED)              | not_eligible          | not_eligible          |
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
  return { status: 'inquiry', ...extras } as CaseUIResponse;
}
function investigating(extras: Partial<CaseUIResponse> = {}): CaseUIResponse {
  return { status: 'investigating', ...extras } as CaseUIResponse;
}
function resolved(extras: Partial<CaseUIResponse> = {}): CaseUIResponse {
  return { status: 'resolved', ...extras } as CaseUIResponse;
}
function closed(extras: Partial<CaseUIResponse> = {}): CaseUIResponse {
  return { status: 'closed', ...extras } as CaseUIResponse;
}

describe('getCaseActionOptions', () => {
  describe('INQUIRY', () => {
    it('always offers the investigating transition (phase change, not gated)', () => {
      const opts = getCaseActionOptions(
        inquiry({
          disposition_eligibility: { resolved: 'not_eligible', closed: 'ready' },
        }),
      );
      expect(opts.some((o) => o.status === 'investigating')).toBe(true);
      // The investigating transition is not gated by disposition_eligibility;
      // its eligibility slot must be null.
      const inv = opts.find((o) => o.status === 'investigating');
      expect(inv?.eligibility).toBeNull();
    });

    it('offers closed:ready alongside investigating in the default INQUIRY shape', () => {
      const opts = getCaseActionOptions(
        inquiry({
          disposition_eligibility: { resolved: 'not_eligible', closed: 'ready' },
        }),
      );
      expect(opts).toContainEqual({ status: 'investigating', eligibility: null });
      expect(opts).toContainEqual({ status: 'closed', eligibility: 'ready' });
      // resolved is not_eligible from INQUIRY (structurally invalid) — drop it.
      expect(opts.some((o) => o.status === 'resolved')).toBe(false);
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
      expect(opts).toEqual([{ status: 'investigating', eligibility: null }]);
    });
  });

  describe('INVESTIGATING — every verdict combination', () => {
    it('thin case (resolved:not_eligible, closed:ready) hides Resolve, shows Close', () => {
      const opts = getCaseActionOptions(
        investigating({
          disposition_eligibility: { resolved: 'not_eligible', closed: 'ready' },
        }),
      );
      expect(opts).toEqual([{ status: 'closed', eligibility: 'ready' }]);
    });

    it('partial case (resolved:needs_info, closed:ready) shows both with needs_info on Resolve', () => {
      const opts = getCaseActionOptions(
        investigating({
          disposition_eligibility: { resolved: 'needs_info', closed: 'ready' },
        }),
      );
      expect(opts).toEqual([
        { status: 'resolved', eligibility: 'needs_info' },
        { status: 'closed', eligibility: 'ready' },
      ]);
    });

    it('resolution-grade case (resolved:ready, closed:suggests_alternative) shows both with the alt warning on Close', () => {
      const opts = getCaseActionOptions(
        investigating({
          disposition_eligibility: {
            resolved: 'ready',
            closed: 'suggests_alternative',
          },
        }),
      );
      expect(opts).toEqual([
        { status: 'resolved', eligibility: 'ready' },
        { status: 'closed', eligibility: 'suggests_alternative' },
      ]);
    });

    it('fully ready case (resolved:ready, closed:ready) shows both unadorned', () => {
      const opts = getCaseActionOptions(
        investigating({
          disposition_eligibility: { resolved: 'ready', closed: 'ready' },
        }),
      );
      expect(opts).toEqual([
        { status: 'resolved', eligibility: 'ready' },
        { status: 'closed', eligibility: 'ready' },
      ]);
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
      // All eligibility null on the fallback path — no per-verdict UX.
      expect(opts).toEqual([
        { status: 'resolved', eligibility: null },
        { status: 'closed', eligibility: null },
      ]);
    });

    it('falls back to hardcoded defaults when both eligibility and valid_next_states are absent', () => {
      const opts = getCaseActionOptions(investigating());
      // Last-resort safety net — keep the dropdown non-empty.
      expect(opts).toEqual([
        { status: 'resolved', eligibility: null },
        { status: 'closed', eligibility: null },
      ]);
    });

    it('INQUIRY fallback always retains the investigating transition', () => {
      const opts = getCaseActionOptions(inquiry());
      expect(opts.some((o) => o.status === 'investigating')).toBe(true);
    });
  });
});
