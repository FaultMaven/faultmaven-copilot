import { describe, it, expect } from 'vitest';
import {
  reconcileOptimisticIds,
  slotOf
} from '@faultmaven/copilot-ui/lib/state/reconcile-message-ids';
import type { OptimisticConversationItem } from '@faultmaven/copilot-ui/lib/optimistic';

const row = (r: Partial<OptimisticConversationItem> & { id: string }) =>
  ({ optimistic: false, timestamp: '2026-08-20T10:00:00Z', ...r }) as OptimisticConversationItem;

/** A turn as it exists locally right after `useMessageSubmission` succeeds. */
const localTurn = (turn: number, q: string, a: string) => [
  row({ id: `opt_msg_${turn}_1`, question: q, turn_number: turn }),
  row({ id: `opt_msg_${turn}_2`, response: a, turn_number: turn })
];

/** The same turn as the backend serves it back. */
const backendTurn = (turn: number, q: string, a: string) => [
  row({ id: `m-${turn}-u`, question: q, turn_number: turn }),
  row({ id: `m-${turn}-a`, response: a, turn_number: turn })
];

describe('slotOf', () => {
  it('identifies a slot by truthiness, not presence', () => {
    // The optimistic items carry `response: ''` alongside a real question (and
    // vice versa), so a presence check would report the wrong slot.
    expect(slotOf({ question: 'q', response: '' })).toBe('question');
    expect(slotOf({ question: '', response: 'a' })).toBe('response');
    expect(slotOf({ notice: 'draft ready' })).toBe('notice');
    expect(slotOf({ question: '', response: '' })).toBeNull();
    expect(slotOf({})).toBeNull();
  });
});

describe('reconcileOptimisticIds', () => {
  it('adopts the backend id onto a locally-minted turn instead of duplicating it', () => {
    const existing = localTurn(5, 'why is it down', 'checking');
    const incoming = backendTurn(5, 'why is it down', 'checking');

    const { rows, adopted } = reconcileOptimisticIds(existing, incoming);

    expect(rows.map((r) => r.id)).toEqual(['m-5-u', 'm-5-a']);
    // Both incoming rows were claimed, so the caller appends neither.
    expect([...adopted].sort()).toEqual(['m-5-a', 'm-5-u']);
  });

  it('is self-healing: a second pass finds nothing left to do', () => {
    // After the first reconciliation the rows carry backend ids, so ordinary id
    // dedup takes over and this code never touches them again.
    const once = reconcileOptimisticIds(
      localTurn(5, 'q', 'a'),
      backendTurn(5, 'q', 'a')
    );
    const twice = reconcileOptimisticIds(once.rows, backendTurn(5, 'q', 'a'));

    expect(twice.adopted.size).toBe(0);
    expect(twice.rows).toBe(once.rows); // unchanged by reference
  });

  it('takes the backend content and turn number, which are authoritative', () => {
    // Content may have been redacted server-side, and the user row's local
    // turn_number was a client-side prediction.
    const existing = [row({ id: 'opt_msg_1', question: 'token abc123', turn_number: 7 })];
    const incoming = [row({ id: 'm-9', question: 'token [REDACTED]', turn_number: 7 })];

    const { rows } = reconcileOptimisticIds(existing, incoming);

    expect(rows[0].question).toBe('token [REDACTED]');
    expect(rows[0].id).toBe('m-9');
    expect(rows[0].originalId).toBe('m-9');
  });

  it('writes only the slot that matched, leaving any other content intact', () => {
    // `ChatWindow` renders `question` and `response` off the same item
    // independently, so a row with two truthy slots is renderable. Adopting on
    // the question match must not clear the response — the content is not
    // recoverable, since the backend row carrying it may already sit behind the
    // delta offset. No current path mints such a row; this pins the property so
    // one could not silently lose data later.
    const existing = [
      row({ id: 'opt_msg_1', question: 'q', response: 'a', turn_number: 3 })
    ];
    const incoming = [row({ id: 'm-3-u', question: 'q from backend', turn_number: 3 })];

    const { rows } = reconcileOptimisticIds(existing, incoming);

    expect(rows[0].id).toBe('m-3-u');
    expect(rows[0].question).toBe('q from backend');
    expect(rows[0].response).toBe('a'); // untouched
  });

  it('never swallows a notice sharing a turn with the exchange it landed during', () => {
    // The failure that would quietly undo #209. A notice carries the turn that
    // was open when its background job finished — the same turn as a local
    // question/response pair — so a turn-number-only match would consume it.
    const existing = localTurn(4, 'generate a runbook', 'Creating your runbook draft.');
    const incoming = [
      row({ id: 'm-4-sys', notice: 'Runbook generation failed.', turn_number: 4 })
    ];

    const { rows, adopted } = reconcileOptimisticIds(existing, incoming);

    expect(adopted.size).toBe(0);
    expect(rows).toBe(existing);
    // …so the caller appends it, and the notice reaches the user.
  });

  it('leaves two notices in one turn alone', () => {
    const existing = [row({ id: 'opt_msg_1', notice: 'first', turn_number: 4 })];
    const incoming = [
      row({ id: 'm-a', notice: 'first', turn_number: 4 }),
      row({ id: 'm-b', notice: 'second', turn_number: 4 })
    ];

    const { adopted } = reconcileOptimisticIds(existing, incoming);

    // The single local notice can be claimed once; the second incoming row
    // falls through to the append path rather than overwriting the adoption.
    expect(adopted.has('m-a')).toBe(true);
    expect(adopted.has('m-b')).toBe(false);
  });

  it('refuses an ambiguous (turn, slot) rather than guessing', () => {
    // Two local rows in the same slot of the same turn should not happen — a
    // user message increments the turn — but adopting an id onto the wrong turn
    // is worse than the duplicate this exists to prevent, so it declines.
    const existing = [
      row({ id: 'opt_msg_1', question: 'first', turn_number: 3 }),
      row({ id: 'opt_msg_2', question: 'second', turn_number: 3 })
    ];
    const incoming = [row({ id: 'm-3-u', question: 'first', turn_number: 3 })];

    const { rows, adopted } = reconcileOptimisticIds(existing, incoming);

    expect(adopted.size).toBe(0);
    expect(rows).toBe(existing);
  });

  it('ignores rows that already carry a backend id', () => {
    const existing = [row({ id: 'm-real', question: 'q', turn_number: 2 })];
    const incoming = [row({ id: 'm-other', question: 'q', turn_number: 2 })];

    const { rows, adopted } = reconcileOptimisticIds(existing, incoming);

    expect(adopted.size).toBe(0);
    expect(rows).toBe(existing);
  });

  it('ignores an in-flight optimistic row, which the submission hook still owns', () => {
    const existing = [
      row({ id: 'opt_msg_1', question: 'q', turn_number: 2, optimistic: true }),
      row({ id: 'opt_msg_2', response: '', turn_number: 2, optimistic: true, loading: true })
    ];
    const incoming = [row({ id: 'm-2-u', question: 'q', turn_number: 2 })];

    const { adopted } = reconcileOptimisticIds(existing, incoming);

    expect(adopted.size).toBe(0);
  });

  it('reconciles only the turn it can identify, appending the rest', () => {
    const existing = [
      row({ id: 'm-1-u', question: 'old', turn_number: 1 }), // backend-sourced
      ...localTurn(2, 'new question', 'new answer')
    ];
    const incoming = [
      ...backendTurn(2, 'new question', 'new answer'),
      row({ id: 'm-3-sys', notice: 'Your runbook draft is ready.', turn_number: 2 })
    ];

    const { rows, adopted } = reconcileOptimisticIds(existing, incoming);

    expect(rows.map((r) => r.id)).toEqual(['m-1-u', 'm-2-u', 'm-2-a']);
    expect(adopted.has('m-3-sys')).toBe(false);
  });
});
