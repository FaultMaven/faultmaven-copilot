/**
 * What a backend transcript row IS, for a client that renders a conversation.
 *
 * `GET /cases/{id}/messages` serves three roles — the backend CHECK constraint
 * is `role IN ('user', 'assistant', 'system')` — but the side panel's model was
 * strictly question/response, so every `system` row was filtered out at the
 * delta fetch. That silence was not cosmetic: `system` is the channel the
 * backend uses to report the outcome of background work it started on the
 * user's behalf, and the runbook-conversion FAILURE notices travel on it too
 * (faultmaven `milestone_engine._run_runbook_conversion`, as of faultmaven#1135):
 *
 *     "Runbook generation failed, so no draft was created for this case. You can
 *      write one yourself in the Dashboard under **Knowledge Base**."
 *
 * A failed conversion was therefore completely silent in the extension: no
 * draft appeared, nothing said one had failed, and the durable way out named in
 * that sentence was written into a message the reader could not see (#209).
 * faultmaven#1135 removed the initiating turn's promise of an in-chat
 * notification precisely because this client could not honour it — which is the
 * gap this closes, not a reason the channel stopped mattering.
 *
 * So a row is one of three kinds, and `notice` is the DEFAULT rather than a
 * special case for `system`. The parameter is `string`, not the generated
 * `role` union, precisely because the default arm is about values the contract
 * does not declare: a role added server-side later must not inherit the silence
 * this replaced, and must never be presented as something a participant said.
 * Do not narrow this to an equality test on `'system'`.
 *
 * `notice` is also the safe direction for the OTHER failure mode. The Dashboard
 * had the mirror-image bug — its transcript rendered every non-`assistant` row
 * as "You", so a user was shown announcing their own runbook draft
 * (faultmaven-dashboard#105). Defaulting an unrecognised role to a
 * non-participant notice cannot misattribute; defaulting it to either
 * conversational side can.
 *
 * The classification is shared rather than inlined at the one call site so the
 * mapper and any future reader of `role` cannot drift apart, and so the
 * decision itself is testable without a store or a render.
 */

/** The three ways a transcript row can enter the conversation. */
export type MessageKind = 'user' | 'assistant' | 'notice';

/**
 * Classify a backend message role for display.
 *
 * Mirrors `messageKind` in faultmaven-dashboard (`lib/cases/messageAttribution.ts`,
 * on `main` since faultmaven-dashboard#105) — the two clients render the same
 * transcript and should not disagree about what a row is. Kept as a copy rather than a shared package: this is nine lines
 * with no dependencies, and the repos share no runtime code today.
 */
export function messageKind(role: string): MessageKind {
  if (role === 'user') return 'user';
  if (role === 'assistant') return 'assistant';
  return 'notice';
}
