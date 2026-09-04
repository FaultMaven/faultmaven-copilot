import type { UserCase } from '../../types/case';

export interface CaseSnapshot {
  id: string | null;
  state: UserCase['state'] | null;
}

/**
 * Whether an activeCase change is a TRANSITION (the same case observed
 * changing state) as opposed to an observation (selecting or hydrating a
 * different case, which merely reveals state that already existed).
 *
 * Reconciliation — sidebar list-cache invalidation, list refetch, sessions
 * refresh — is warranted only by transitions. Keying it on observations made
 * every case select cost a full network list fetch. A case switch therefore
 * only resets the baseline; it never reconciles by itself.
 *
 * Known accepted false positive: reopening a terminal case flips the
 * synchronous 'inquiry' placeholder to the hydrated terminal state on the
 * same case id, which reads as a transition. That costs one reconcile per
 * terminal-case reopen — the same cost this path had before gating — and
 * goes away if the placeholder ever becomes a real loading state.
 */
export function isCaseTransition(prev: CaseSnapshot, next: CaseSnapshot): boolean {
  return next.id !== null && next.id === prev.id && next.state !== prev.state;
}
