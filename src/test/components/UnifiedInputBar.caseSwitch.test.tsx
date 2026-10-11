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

  it('a draft whose own send creates the case and is refused keeps its input (#318)', async () => {
    let settle!: (v: unknown) => void;
    const turn = vi.fn().mockReturnValue(new Promise((r) => { settle = r; }));
    const { switchTo } = mount(null, { turn });
    await stageEverything();
    send();
    await waitFor(() => expect(turn).toHaveBeenCalledTimes(1));
    // The upload hook creates the case and makes it active while the turn is in flight.
    switchTo('case-new');
    settle({ success: false, message: 'closed', sent: true, refused: true });
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled());
    expect(box()).toHaveValue('why?');
    expect(screen.getByText('app.log')).toBeInTheDocument();
    expect(screen.getByText(/Pasted context/)).toBeInTheDocument();
  });

  it('a draft question whose case-create failed and rolled back gets its text back', async () => {
    let settle!: (v: unknown) => void;
    const query = vi.fn().mockReturnValue(new Promise((r) => { settle = r; }));
    const { switchTo } = mount(null, { query });
    fireEvent.change(box(), { target: { value: 'why is it down?' } });
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: false });
    switchTo('opt_case_9');
    switchTo(null);
    settle({ sent: false });
    await waitFor(() => expect(box()).toHaveValue('why is it down?'));
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
