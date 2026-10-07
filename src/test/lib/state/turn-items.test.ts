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

const IDS = { user: 'opt_msg_user', assistant: 'opt_msg_ai' };

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
  // How the server reports a match: the stored file's id, and the turn it arrived on.
  const duplicateOf = (duplicate_turn: number | null) =>
    attachment({ filename: 'old.log', processing_status: 'duplicate', file_id: 'file_1', duplicate_of: 'file_1', duplicate_turn });
  // `rows()` as submitted: committed history up to clock 3 (labelled turn 2),
  // then this submission's user row on its predicted clock 4.
  const reupload = (...attachments: AttachmentResult[]) =>
    duplicateUploads(turn({ attachments_processed: attachments }), rows(), IDS.user);

  it('names nothing when every attachment is new', () => {
    expect(reupload(attachment({}))).toEqual([]);
    expect(duplicateUploads(turn({ attachments_processed: undefined }), rows(), IDS.user)).toEqual([]);
  });

  // `duplicate_turn` is the message clock. The committed row on clock 3 is
  // investigation turn 2, which is what the conversation prints for it.
  it('gives a re-upload the turn the conversation prints, not the clock', () => {
    expect(reupload(attachment({}), duplicateOf(3))).toEqual([{ filename: 'old.log', turn: 2 }]);
  });

  it('leaves the turn out when no loaded row labels it', () => {
    expect(reupload(duplicateOf(1))).toEqual([{ filename: 'old.log' }]);
  });

  // The server commits an uploaded file before the turn can fail, and replays
  // only a successful response, so a retry matches its own first attempt: on
  // this submission's clock (4), or later if the failure advanced the clock.
  it("does not call a retry's match against its own failed attempt a re-upload", () => {
    expect(reupload(duplicateOf(4))).toEqual([]);
    expect(reupload(duplicateOf(5))).toEqual([]);
  });

  // An earlier turn that failed keeps its rows, numbered by prediction. Its
  // clock is not a turn the server used, so it does not make a later turn's
  // match look earlier.
  it("does not count a failed turn's predicted number as history", () => {
    const withFailedTurn: OptimisticConversationItem[] = [
      { id: 'msg_committed', response: 'Earlier reply.', timestamp: 't0', optimistic: false, turn_number: 3, investigation_turn: 2 },
      { id: 'opt_msg_failed_user', question: 'First try', timestamp: 't1', optimistic: true, turn_number: 4 },
      { id: 'opt_msg_failed_ai', response: 'Network error', timestamp: 't1', optimistic: false, error: true, failed: true, turn_number: 4 },
      { id: IDS.user, question: 'What now?', timestamp: 't2', optimistic: true, turn_number: 5 },
      { id: IDS.assistant, response: '', timestamp: 't2', optimistic: true, loading: true, turn_number: 5 },
    ];
    const response = turn({ attachments_processed: [duplicateOf(4)] });

    expect(duplicateUploads(response, withFailedTurn, IDS.user)).toEqual([]);
  });

  // A fetch can merge newer committed rows in ahead of a submission that is
  // waiting for its retry. The submission's own predicted turn still bounds it.
  it('bounds a match by the turn this submission was sent on', () => {
    const merged: OptimisticConversationItem[] = [
      { id: 'msg_committed', response: 'Earlier reply.', timestamp: 't0', optimistic: false, turn_number: 3 },
      { id: 'msg_elsewhere', response: 'From another device.', timestamp: 't1', optimistic: false, turn_number: 6 },
      { id: IDS.user, question: 'What now?', timestamp: 't0', optimistic: true, turn_number: 4 },
      { id: IDS.assistant, response: '', timestamp: 't0', optimistic: true, loading: true, turn_number: 4 },
    ];
    const response = turn({ attachments_processed: [duplicateOf(4), duplicateOf(3)] });

    expect(duplicateUploads(response, merged, IDS.user)).toEqual([{ filename: 'old.log' }]);
  });

  it('reports nothing when it cannot tell the original came earlier', () => {
    expect(reupload(duplicateOf(null))).toEqual([]);
    expect(duplicateUploads(turn({ attachments_processed: [duplicateOf(3)] }), undefined, IDS.user)).toEqual([]);
    // A new case: no committed history before this submission.
    const fresh = rows().filter((row) => row.id !== 'msg_committed');
    expect(duplicateUploads(turn({ attachments_processed: [duplicateOf(3)] }), fresh, IDS.user)).toEqual([]);
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
