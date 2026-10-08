/**
 * `applyTurnResponse` / `suggestionFromResponse`: the one mapping from a
 * `TurnResponse` to stored rows (#305).
 *
 * Both turn paths used to write their own mapping behind an
 * `as OptimisticConversationItem` cast, so a field could reach one path and not
 * the other, and a suggestion `type` the client does not know reached
 * `SuggestionCard` unchecked. These cover the mapping itself, the suggestion
 * narrowing, and that neither hook has grown its own mapping again.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { applyTurnResponse, duplicateUploads, suggestionFromResponse } from '@faultmaven/copilot-ui/lib/state/turn-items';
import type { AttachmentResult, TurnResponse } from '@faultmaven/copilot-ui/lib/api';
import type { OptimisticConversationItem } from '@faultmaven/copilot-ui/lib/optimistic';

const IDS = { user: 'opt_msg_user', assistant: 'opt_msg_ai', presentAtSend: new Set<string>() };

function turn(overrides: Partial<TurnResponse> = {}): TurnResponse {
  return {
    agent_response: 'Reply.',
    turn_number: 7,
    milestones_completed: [],
    case_state: 'investigating',
    progress_made: true,
    ...overrides,
  };
}

/** A committed exchange, then the two optimistic rows a submission minted. */
function rows({ historyCarriesInvestigationTurn = true } = {}): OptimisticConversationItem[] {
  const committedInvestigationTurn = historyCarriesInvestigationTurn ? 2 : undefined;
  return [
    {
      id: 'msg_committed',
      response: 'Earlier reply.',
      timestamp: '2026-10-07T10:00:00Z',
      optimistic: false,
      turn_number: 3,
      investigation_turn: committedInvestigationTurn,
    },
    {
      id: IDS.user,
      question: 'What now?',
      timestamp: '2026-10-07T10:01:00Z',
      optimistic: true,
      turn_number: 4,
      // Predicted the way the hooks predict it: from the committed rows, and
      // null when none of them carries the field.
      investigation_turn: committedInvestigationTurn === undefined ? null : committedInvestigationTurn + 1,
    },
    {
      id: IDS.assistant,
      response: '',
      timestamp: '2026-10-07T10:01:00Z',
      optimistic: true,
      loading: true,
      turn_number: 4,
    },
  ];
}

function row(items: OptimisticConversationItem[], id: string): OptimisticConversationItem {
  const found = items.find((item) => item.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

describe('applyTurnResponse', () => {
  it("commits both optimistic rows on the server's turn number and leaves every other row as it was", () => {
    const before = rows();
    const after = applyTurnResponse(before, IDS, turn({ turn_number: 7, investigation_turn: 5 }));

    expect(after[0]).toBe(before[0]);
    expect(row(after, IDS.user)).toMatchObject({
      question: 'What now?',
      optimistic: false,
      turn_number: 7,
      investigation_turn: 5,
      originalId: IDS.user,
    });
    expect(row(after, IDS.assistant)).toMatchObject({
      response: 'Reply.',
      optimistic: false,
      loading: false,
      turn_number: 7,
      investigation_turn: 5,
      originalId: IDS.assistant,
    });
  });

  it('clears the error state a failed attempt left on the assistant row', () => {
    const failed = rows().map((item) =>
      item.id === IDS.assistant
        ? { ...item, error: true, failed: true, errorMessage: 'Network error' }
        : item
    );

    const assistant = row(applyTurnResponse(failed, IDS, turn()), IDS.assistant);

    expect(assistant.error).toBe(false);
    expect(assistant.failed).toBe(false);
    expect(assistant.errorMessage).toBeUndefined();
  });

  it('labels the turn with the investigation count only when the history already carries one', () => {
    const response = turn({ investigation_turn: 5 });

    const supplied = applyTurnResponse(rows(), IDS, response);
    expect(row(supplied, IDS.user).investigation_turn).toBe(5);

    // A server older than contract 3.5.0 sends the field on the turn response
    // but not on history rows; this turn stays on the clock with its neighbours.
    const older = applyTurnResponse(rows({ historyCarriesInvestigationTurn: false }), IDS, response);
    expect(row(older, IDS.user).investigation_turn).toBeNull();
    expect(row(older, IDS.assistant).investigation_turn).toBeNull();
  });

  it('shows the fallback text only when the turn answered with none', () => {
    const fallback = { emptyResponseText: 'Data uploaded and processed successfully.' };

    const empty = applyTurnResponse(rows(), IDS, turn({ agent_response: '' }), fallback);
    expect(row(empty, IDS.assistant).response).toBe('Data uploaded and processed successfully.');

    const answered = applyTurnResponse(rows(), IDS, turn({ agent_response: 'Found it.' }), fallback);
    expect(row(answered, IDS.assistant).response).toBe('Found it.');
  });

  it("takes the server's attachments when it reports them, and keeps the row's when it does not", () => {
    const local: AttachmentResult = {
      file_id: 'local-1',
      filename: 'app.log',
      file_size: 10,
      processing_status: 'pending',
      source_type: 'log',
      upload_source: 'file_upload',
      uploaded_at: '2026-10-07T10:01:00Z',
    };
    const served: AttachmentResult = { ...local, file_id: 'file_9', processing_status: 'completed' };
    const withLocal = rows().map((item) => (item.id === IDS.user ? { ...item, attachments: [local] } : item));

    const reported = applyTurnResponse(withLocal, IDS, turn({ attachments_processed: [served] }));
    expect(row(reported, IDS.user).attachments).toEqual([served]);

    const omitted = applyTurnResponse(withLocal, IDS, turn({ attachments_processed: undefined }));
    expect(row(omitted, IDS.user).attachments).toEqual([local]);
  });

  it("narrows the turn's suggestions", () => {
    const after = applyTurnResponse(
      rows(),
      IDS,
      turn({
        suggested_actions: [
          { label: 'Check the pod', type: 'DECIDE', payload: 'Check the pod.' },
          { label: 'Compare dashboards', type: 'COMPARE', body: 'Grafana vs logs' },
        ],
      })
    );

    expect(row(after, IDS.assistant).suggestedActions?.map((action) => action.type)).toEqual([
      'DECIDE',
      'UNRECOGNIZED',
    ]);
  });

  it('stores null suggestions when the turn sent none', () => {
    expect(row(applyTurnResponse(rows(), IDS, turn()), IDS.assistant).suggestedActions).toBeNull();
  });
});

describe('suggestionFromResponse', () => {
  it.each(['DECIDE', 'RUN', 'EVIDENCE', 'FREE_SPEECH'])('keeps the known type %s', (type) => {
    expect(suggestionFromResponse({ label: 'x', type }).type).toBe(type);
  });

  // `type` is a bare string in the contract. Anything else, including a case
  // variant of a known type, is not a type this build can act on.
  it.each(['COMPARE', 'decide', ''])('narrows the unknown type %j to UNRECOGNIZED', (type) => {
    expect(suggestionFromResponse({ label: 'x', type }).type).toBe('UNRECOGNIZED');
  });

  it("turns the contract's nulls into absent fields", () => {
    const action = suggestionFromResponse({
      label: 'Upload logs',
      type: 'EVIDENCE',
      payload: null,
      body: null,
      hints: null,
      intent: null,
      evidence_need_id: null,
    });

    expect(action.payload).toBeUndefined();
    expect(action.body).toBeUndefined();
    expect(action.hints).toBeUndefined();
    expect(action.intent).toBeUndefined();
    expect(action.evidence_need_id).toBeUndefined();
  });

  // The server routes the click on keys this client does not declare and on
  // intent types it does not enumerate. Rebuilding the intent from known fields
  // would drop them, and the click would stop doing what it offered.
  it('keeps an intent whole: its undeclared keys and an intent type the client does not enumerate', () => {
    const reclassify = { type: 'file_reclassification', file_id: 'file_42', data_type: 'logs_and_errors' };
    const confirm = { type: 'confirmation', confirmation_value: true, proposal_id: 'gate1:7f3a' };

    expect(suggestionFromResponse({ label: 'Logs', type: 'DECIDE', payload: 'Logs', intent: reclassify }).intent)
      .toEqual(reclassify);
    expect(suggestionFromResponse({ label: 'Yes', type: 'DECIDE', payload: 'Yes', intent: confirm }).intent)
      .toEqual(confirm);
  });

  it('drops an intent with no usable type, which the request could not name', () => {
    expect(suggestionFromResponse({ label: 'x', type: 'DECIDE', intent: { file_id: 'f' } }).intent).toBeUndefined();
    expect(suggestionFromResponse({ label: 'x', type: 'DECIDE', intent: { type: 3 } }).intent).toBeUndefined();
    expect(suggestionFromResponse({ label: 'x', type: 'DECIDE', intent: { type: '', file_id: 'f' } }).intent).toBeUndefined();
  });
});

describe('duplicateUploads', () => {
  const attachment = (overrides: Partial<AttachmentResult>): AttachmentResult => ({
    file_id: 'file_9',
    filename: 'app.log',
    file_size: 10,
    processing_status: 'completed',
    source_type: 'log',
    upload_source: 'file_upload',
    uploaded_at: '2026-10-07T10:01:00Z',
    ...overrides,
  });
  // How the server reports a content match: the stored file's id as both
  // `file_id` and `duplicate_of`, and the clock turn the original arrived on.
  const duplicateOf = (duplicate_turn: number | null, overrides: Partial<AttachmentResult> = {}) =>
    attachment({
      filename: 'renamed.log',
      processing_status: 'duplicate',
      file_id: 'file_1',
      duplicate_of: 'file_1',
      duplicate_turn,
      ...overrides,
    });
  // `rows()` as submitted: committed history up to clock 3 (labelled turn 2).
  const found = (...attachments: AttachmentResult[]) =>
    duplicateUploads(turn({ attachments_processed: attachments }), rows());

  it('names nothing when every attachment is new', () => {
    expect(found(attachment({}))).toEqual([]);
    expect(duplicateUploads(turn({ attachments_processed: undefined }), rows())).toEqual([]);
  });

  // `duplicate_turn` is the message clock. The committed row on clock 3 is
  // investigation turn 2, which is what the conversation prints for it.
  it('names a match with the turn the conversation prints, not the clock', () => {
    expect(found(attachment({}), duplicateOf(3))).toEqual([
      { filename: 'renamed.log', origin: 'file_upload', turn: 2 },
    ]);
  });

  it('says how the matched upload arrived', () => {
    expect(found(duplicateOf(3, { filename: 'pasted-content-1.txt', upload_source: 'paste' }))).toEqual([
      { filename: 'pasted-content-1.txt', origin: 'text_paste', turn: 2 },
    ]);
  });

  it('leaves the turn out when no committed row labels it', () => {
    expect(found(duplicateOf(1))).toEqual([{ filename: 'renamed.log', origin: 'file_upload' }]);
    expect(found(duplicateOf(null))).toEqual([{ filename: 'renamed.log', origin: 'file_upload' }]);
    expect(duplicateUploads(turn({ attachments_processed: [duplicateOf(3)] }), undefined)).toEqual([
      { filename: 'renamed.log', origin: 'file_upload' },
    ]);
  });

  // A failed upload keeps its rows, labelled by prediction. A committed row on
  // the same clock carries the label the conversation actually prints.
  it("labels from committed rows only, never a failed row's prediction", () => {
    const history: OptimisticConversationItem[] = [
      { id: 'opt_msg_failed_user', question: 'logs', timestamp: 't0', optimistic: true, turn_number: 6, investigation_turn: 5 },
      { id: 'opt_msg_failed_ai', response: 'Network error', timestamp: 't0', optimistic: false, error: true, failed: true, turn_number: 6, investigation_turn: 5 },
      { id: 'msg_aside', response: 'An aside.', timestamp: 't1', optimistic: false, turn_number: 6, investigation_turn: 4 },
    ];
    const response = turn({ attachments_processed: [duplicateOf(6)] });

    expect(duplicateUploads(response, history)).toEqual([
      { filename: 'renamed.log', origin: 'file_upload', turn: 4 },
    ]);
    expect(duplicateUploads(response, history.slice(0, 2))).toEqual([
      { filename: 'renamed.log', origin: 'file_upload' },
    ]);
  });

  // The server stores the first copy under a new file_id, and the second copy's
  // `duplicate_of` names it: the case did not hold it before this submission.
  // Both fields are on the message clock. An older server stamps a failed
  // attempt's file with the turn number the retry then takes.
  it('skips a match on this very turn: it is the failed attempt, not held data', () => {
    expect(duplicateUploads(turn({ turn_number: 4, attachments_processed: [duplicateOf(4)] }), rows())).toEqual([]);
  });

  it('reports a match on an earlier turn', () => {
    expect(duplicateUploads(turn({ turn_number: 4, attachments_processed: [duplicateOf(3)] }), rows())).toEqual([
      { filename: 'renamed.log', origin: 'file_upload', turn: 2 },
    ]);
  });

  // faultmaven#1882: turn 3 committed with its file while the client saw an
  // error; the retry runs as turn 4 and truly matches the committed upload.
  it('reports the retry of a turn that committed (duplicate_turn N, response N+1)', () => {
    expect(duplicateUploads(turn({ turn_number: 4, attachments_processed: [duplicateOf(3)] }), rows())).toHaveLength(1);
  });

  it('does not report a second copy of something this same submission stored', () => {
    const first = attachment({ file_id: 'file_new' });
    const second = duplicateOf(4, { file_id: 'file_new', duplicate_of: 'file_new' });

    expect(found(first, second)).toEqual([]);
    expect(found(first, second, duplicateOf(3))).toEqual([{ filename: 'renamed.log', origin: 'file_upload', turn: 2 }]);
  });
});

describe('the turn hooks', () => {
  const HOOKS = [
    'packages/copilot-ui/shared/ui/hooks/useMessageSubmission.ts',
    'packages/copilot-ui/shared/ui/hooks/useDataUpload.ts',
  ];

  // Comments may name the fields; code may not.
  const code = (file: string) =>
    readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it.each(HOOKS)('%s builds rows without a cast and commits a turn through applyTurnResponse', (file) => {
    const source = code(file);
    expect(source).not.toContain('as OptimisticConversationItem');
    expect(source).toContain('applyTurnResponse(');
    // The mapping lives in one place: a hook naming the response's fields at
    // all (dot, bracket or destructuring) is writing a second mapping.
    expect(source).not.toMatch(/\b(suggested_actions|sources|agent_response)\b/);
  });
});

// A delta fetch while the turn was in flight appended the server's copy of it
// beside the optimistic pair (the merge's reconciliation skips in-flight rows).
// The response's own turn number identifies the copy (faultmaven#1888).
describe('applyTurnResponse — a backend copy of the turn already merged', () => {
  const committed: OptimisticConversationItem = {
    id: 'msg_committed', response: 'Earlier reply.', timestamp: '2026-10-07T10:00:00Z', optimistic: false, turn_number: 6,
  };
  const copyQ: OptimisticConversationItem = {
    id: 'msg_u7', question: 'What now? (server copy)', timestamp: '2026-10-07T10:01:00Z', optimistic: false, turn_number: 7,
  };
  const copyA: OptimisticConversationItem = {
    id: 'msg_a7', response: 'Reply.', timestamp: '2026-10-07T10:01:05Z', optimistic: false, turn_number: 7,
  };
  const notice: OptimisticConversationItem = {
    id: 'msg_n7', notice: 'Runbook conversion queued.', timestamp: '2026-10-07T10:01:06Z', optimistic: false, turn_number: 7,
  };
  const userRow = (turnNumber = 7): OptimisticConversationItem => (
    { id: IDS.user, question: 'What now?', timestamp: '2026-10-07T10:01:00Z', optimistic: true, turn_number: turnNumber }
  );
  const aiRow = (turnNumber = 7): OptimisticConversationItem => (
    { id: IDS.assistant, response: '', timestamp: '2026-10-07T10:01:00Z', optimistic: true, loading: true, turn_number: turnNumber }
  );
  const pair = (turnNumber = 7) => [userRow(turnNumber), aiRow(turnNumber)];
  /** The ids the conversation held when the turn was sent. */
  const sentWith = (...present: string[]) => ({ ...IDS, presentAtSend: new Set(present) });

  it('drops the copy and gives the pair its identity; a notice of the same turn stays', () => {
    const out = applyTurnResponse([committed, copyQ, copyA, notice, ...pair()], sentWith('msg_committed'), turn());
    expect(out.map((r) => r.id)).toEqual(['msg_committed', 'msg_n7', 'msg_u7', 'msg_a7']);
    expect(out[2]).toMatchObject({ question: 'What now? (server copy)', originalId: 'msg_u7', optimistic: false });
    expect(out[3]).toMatchObject({ response: 'Reply.', originalId: 'msg_a7', loading: false });
  });

  it('matches on the RESPONSE turn, not the prediction', () => {
    // Predicted 5, committed 7: the copy at 7 is still this turn.
    const out = applyTurnResponse([committed, copyQ, copyA, ...pair(5)], sentWith('msg_committed'), turn());
    expect(out.map((r) => r.id)).toEqual(['msg_committed', 'msg_u7', 'msg_a7']);
  });

  it('leaves rows of another turn alone', () => {
    const out = applyTurnResponse([committed, copyQ, copyA, ...pair(8)], sentWith(), turn({ turn_number: 8 }));
    expect(out.map((r) => r.id)).toEqual(['msg_committed', 'msg_u7', 'msg_a7', IDS.user, IDS.assistant]);
  });

  it('a full pair of another turn is not this turn’s copy', () => {
    // Both slots matched, merged after the send: only the turn number tells.
    const out = applyTurnResponse([copyQ, copyA, ...pair(8)], sentWith(), turn({ turn_number: 8 }));
    expect(out.map((r) => r.id)).toEqual(['msg_u7', 'msg_a7', IDS.user, IDS.assistant]);
  });

  it('refuses an ambiguous slot, and then adopts nothing', () => {
    const second: OptimisticConversationItem = { ...copyQ, id: 'msg_u7b' };
    const out = applyTurnResponse([copyQ, second, copyA, ...pair()], sentWith(), turn());
    expect(out.map((r) => r.id)).toEqual(['msg_u7', 'msg_u7b', 'msg_a7', IDS.user, IDS.assistant]);
  });

  // `POST /cases` with an `initial_message` stamps that row `turn_number: 1`
  // while `current_turn` stays 0, so the case's first turn commits as turn 1
  // too. The initial message is not this turn's copy: the user's question must
  // survive under its own text.
  it("never takes the case's initial message for the first turn's copy (regression)", () => {
    const initial: OptimisticConversationItem = {
      id: 'msg_initial', question: 'The case was opened with this.', timestamp: '2026-10-07T09:59:00Z', optimistic: false, turn_number: 1,
    };
    const out = applyTurnResponse([initial, ...pair(2)], sentWith('msg_initial'), turn({ turn_number: 1 }));
    expect(out.map((r) => r.id)).toEqual(['msg_initial', IDS.user, IDS.assistant]);
    expect(out[0].question).toBe('The case was opened with this.');
    expect(out[1].question).toBe('What now?');
  });

  it('a row present when the turn was sent is never the copy, even with both slots matched', () => {
    const out = applyTurnResponse([copyQ, copyA, ...pair()], sentWith('msg_u7', 'msg_a7'), turn());
    expect(out.map((r) => r.id)).toEqual(['msg_u7', 'msg_a7', IDS.user, IDS.assistant]);
  });

  it('one slot alone is not a copy: a turn commits both rows at once', () => {
    // Merged after the send (so not excluded by presentAtSend), but alone.
    const out = applyTurnResponse([copyQ, ...pair()], sentWith(), turn());
    expect(out.map((r) => r.id)).toEqual(['msg_u7', IDS.user, IDS.assistant]);
    expect(out[1].question).toBe('What now?');
  });

  it('takes no copy for a slot whose optimistic row is absent', () => {
    const out = applyTurnResponse([copyQ, copyA, aiRow()], sentWith(), turn());
    expect(out.map((r) => r.id)).toEqual(['msg_u7', 'msg_a7', IDS.assistant]);
    expect(out[0].question).toBe('What now? (server copy)');
  });
});
