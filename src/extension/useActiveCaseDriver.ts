import { useEffect } from 'react';
import { isDrivenByOther } from '@faultmaven/copilot-ui/lib/cases/driver';
import { reloadDrivenCaseList } from '@faultmaven/copilot-ui/lib/state/case-list-reload';
import { getEpoch } from '@faultmaven/copilot-ui/lib/state/session-epoch';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';

/**
 * Whether someone other than `viewerId` drives the open case (ADR-020) — the
 * panel's live `readOnly` — and, when that turns true for a case, the sidebar
 * reloads so the case leaves it.
 *
 * The sidebar lists the cases this user drives. A case stops being one in ways
 * that never meet a 403: reassigned while not open (the user clicks its cached
 * row and the hydrated row names someone else), or reassigned during a turn
 * (the turn's 409 version conflict refreshes the row). Each ends with the open
 * case naming another driver, so this host — the only one with a sidebar —
 * reloads the list then, through the same invalidate-then-reload sequence the
 * 403 path uses. Not in `refreshActiveCase`, which also runs in the Dashboard.
 *
 * It fires once per (case, turned read-only): the reload does not change the
 * open case or its driver, so it cannot re-trigger itself. A case handed back
 * and taken away again fires again.
 */
export function useActiveCaseDrivenByOther(viewerId: string | null | undefined): boolean {
  const caseId = useAppStore((state) => state.activeCase?.case_id);
  const driverId = useAppStore((state) => state.activeCase?.driver_id);
  const drivenByOther = isDrivenByOther({ driver_id: driverId }, viewerId);

  useEffect(() => {
    if (!drivenByOther || !caseId) return;
    void reloadDrivenCaseList(getEpoch());
  }, [drivenByOther, caseId]);

  return drivenByOther;
}
