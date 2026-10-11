/**
 * The composer's typed text and staged attachments belong to a case (#339).
 *
 * Opening another case resets them, so nothing typed or staged in case A is
 * sent to case B. Reconciling an optimistic id to its real id, and the case a
 * draft's own send creates, are the same case: the input a refused or unsent
 * turn kept (#318) survives them.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { idMappingManager } from '@faultmaven/copilot-ui/lib/optimistic';
import { claimLazyCase } from '@faultmaven/copilot-ui/lib/state/lazy-case';
import { createStubHost, hostWrapper } from '../support/host';

vi.mock('wxt/browser', () => ({
  browser: { tabs: { query: vi.fn(), sendMessage: vi.fn() } },
}));

import { UnifiedInputBar } from '@faultmaven/copilot-ui/shared/ui/components/UnifiedInputBar';

const box = () => screen.getByLabelText(/Type your message/i) as HTMLTextAreaElement;
const send = () => fireEvent.click(screen.getByRole('button', { name: /send/i }));
const three = 'line 1\nline 2\nline 3';
const paste = (text: string) =>
  fireEvent.paste(box(), { clipboardData: { getData: (t: string) => (t === 'text/plain' ? text : '') } });

function mount(caseId: string | null, handlers: { query?: any; turn?: any } = {}) {
  const query = handlers.query ?? vi.fn().mockResolvedValue({ sent: true });
  const turn = handlers.turn ?? vi.fn().mockResolvedValue({ success: true, message: '', sent: true });
  const wrapper = hostWrapper(createStubHost().host);
  const view = render(<UnifiedInputBar caseId={caseId} onQuerySubmit={query} onTurnSubmit={turn} />, { wrapper });
  const switchTo = (next: string | null) =>
    view.rerender(<UnifiedInputBar caseId={next} onQuerySubmit={query} onTurnSubmit={turn} />);
  return { query, turn, switchTo };
}

async function stageEverything() {
  fireEvent.change(box(), { target: { value: 'why?' } });
  const file = new File(['boom'], 'app.log', { type: 'text/plain' });
  fireEvent.change(screen.getByLabelText('File input'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText('app.log')).toBeInTheDocument());
  paste(three);
  expect(screen.getByText(/Pasted context/)).toBeInTheDocument();
}

describe('UnifiedInputBar — staged input belongs to a case (#339)', () => {
  afterEach(() => idMappingManager.clear());

  it('opening another case clears the typed text, the file, the paste and the undo', async () => {
    const { switchTo } = mount('case-a');
    await stageEverything();
    switchTo('case-b');
    expect(box()).toHaveValue('');
    expect(screen.queryByText('app.log')).not.toBeInTheDocument();
    expect(screen.queryByText(/Pasted context/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /put back in message/i })).not.toBeInTheDocument();
  });

  it('nothing staged in case A is sent to case B', async () => {
    const { switchTo, query, turn } = mount('case-a');
    await stageEverything();
    switchTo('case-b');
    send();
    await Promise.resolve();
    expect(turn).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('a captured page and an open textpad do not follow the user either', async () => {
    const { switchTo } = mount('case-a');
    fireEvent.click(screen.getByRole('button', { name: /analyze current page/i }));
    await waitFor(() => expect(screen.getByText(/Captured: https:\/\/grafana/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /paste data/i }));
    fireEvent.change(screen.getByLabelText('Paste data content'), { target: { value: 'ERROR x' } });
    switchTo('case-b');
    expect(screen.queryByText(/Captured:/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Paste data content')).not.toBeInTheDocument();
  });

  it('starting a new case clears it too', async () => {
    const { switchTo } = mount('case-a');
    await stageEverything();
    switchTo(null);
    expect(box()).toHaveValue('');
    expect(screen.queryByText('app.log')).not.toBeInTheDocument();
  });

  it('opening a case from a new-case draft clears the draft', async () => {
    const { switchTo } = mount(null);
    await stageEverything();
    switchTo('case-b');
    expect(box()).toHaveValue('');
    expect(screen.queryByText(/Pasted context/)).not.toBeInTheDocument();
  });

  it('an optimistic id reconciled to its real id keeps everything', async () => {
    const { switchTo } = mount('opt_case_1');
    await stageEverything();
    idMappingManager.addMapping('opt_case_1', 'case-real');
    switchTo('case-real');
    expect(box()).toHaveValue('why?');
    expect(screen.getByText('app.log')).toBeInTheDocument();
    expect(screen.getByText(/Pasted context/)).toBeInTheDocument();
  });

  /**
   * A send whose hook claims a lazy case (#338: both hooks do, at create start)
   * and then waits. `claimed()` is the optimistic id that send claimed.
   */
  function claimingSend() {
    let settle!: (v: unknown) => void;
    let id: string | null = null;
    const handler = vi.fn(() => {
      id = claimLazyCase();
      return new Promise((r) => { settle = r; });
    });
    return { handler, settle: (v: unknown) => settle(v), claimed: () => id! };
  }

  it('a draft whose own send creates the case and is refused keeps its input (#318)', async () => {
    const turn = claimingSend();
    const { switchTo } = mount(null, { turn: turn.handler });
    await stageEverything();
    send();
    await waitFor(() => expect(turn.handler).toHaveBeenCalledTimes(1));
    // The upload hook claims an optimistic case, then reconciles it to the real one.
    switchTo(turn.claimed());
    idMappingManager.addMapping(turn.claimed(), 'case-new');
    switchTo('case-new');
    turn.settle({ success: false, message: 'closed', sent: true, refused: true });
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled());
    expect(box()).toHaveValue('why?');
    expect(screen.getByText('app.log')).toBeInTheDocument();
    expect(screen.getByText(/Pasted context/)).toBeInTheDocument();
  });

  it('a draft question whose case-create failed and rolled back gets its text back', async () => {
    const query = claimingSend();
    const { switchTo } = mount(null, { query: query.handler });
    fireEvent.change(box(), { target: { value: 'why is it down?' } });
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: false });
    switchTo(query.claimed());
    switchTo(null);
    query.settle({ sent: false });
    await waitFor(() => expect(box()).toHaveValue('why is it down?'));
  });

  describe('the user opens another case while a new chat’s own send is in flight', () => {
    it('a refused upload does not leave its input in that case', async () => {
      const turn = claimingSend();
      const { switchTo } = mount(null, { turn: turn.handler });
      await stageEverything();
      send();
      await waitFor(() => expect(turn.handler).toHaveBeenCalledTimes(1));
      // The user opens case B from the sidebar; the create no longer pulls them back (#338).
      switchTo('case-b');
      turn.settle({ success: false, message: 'closed', sent: true, refused: true });
      // Settled: the box re-enables (Send stays disabled, with nothing to send).
      await waitFor(() => expect(box()).not.toBeDisabled());
      expect(box()).toHaveValue('');
      expect(screen.queryByText('app.log')).not.toBeInTheDocument();
      expect(screen.queryByText(/Pasted context/)).not.toBeInTheDocument();
    });

    it('an unsent question is not put back into that case', async () => {
      const query = claimingSend();
      const { switchTo } = mount(null, { query: query.handler });
      fireEvent.change(box(), { target: { value: 'X' } });
      fireEvent.keyDown(box(), { key: 'Enter', shiftKey: false });
      switchTo('case-b');
      query.settle({ sent: false });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(box()).toHaveValue('');
    });

    it('nor is an optimistic case the composer did not claim its own', async () => {
      const query = claimingSend();
      const { switchTo } = mount(null, { query: query.handler });
      fireEvent.change(box(), { target: { value: 'X' } });
      fireEvent.keyDown(box(), { key: 'Enter', shiftKey: false });
      switchTo('opt_case_someone_else');
      query.settle({ sent: false });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(box()).toHaveValue('');
    });
  });

  it('a question not sent from case A is not put back into case B', async () => {
    let settle!: (v: unknown) => void;
    const query = vi.fn().mockReturnValue(new Promise((r) => { settle = r; }));
    const { switchTo } = mount('case-a', { query });
    fireEvent.change(box(), { target: { value: 'about A' } });
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: false });
    switchTo('case-b');
    settle({ sent: false });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(box()).toHaveValue('');
  });

  it('a fixed case (the Dashboard host) keeps its input across re-renders', async () => {
    const { switchTo } = mount('case-a');
    await stageEverything();
    switchTo('case-a');
    expect(box()).toHaveValue('why?');
    expect(screen.getByText('app.log')).toBeInTheDocument();
  });
});
