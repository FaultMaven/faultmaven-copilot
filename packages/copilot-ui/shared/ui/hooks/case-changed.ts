import { isOptimisticId } from '../../../lib/utils/data-integrity';
import { createLogger } from '../../../lib/utils/logger';

const log = createLogger('case-changed');

/**
 * Tell the host the panel changed a case (`CopilotPanelProps.onCaseChanged`).
 *
 * A notification, so it can never break the panel: a host callback that throws
 * is logged at debug and swallowed. An optimistic (`opt_*`) id names a case the
 * server does not have yet, so a host re-reading it would find nothing — those
 * are dropped rather than announced.
 */
export function notifyCaseChanged(
  onCaseChanged: ((caseId: string) => void) | undefined,
  caseId: string | null | undefined,
): void {
  if (!onCaseChanged || !caseId || isOptimisticId(caseId)) return;
  try {
    onCaseChanged(caseId);
  } catch (error) {
    log.debug('Host onCaseChanged callback threw; ignored', { caseId, error });
  }
}
