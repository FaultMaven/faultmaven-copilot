/**
 * #251 — "Turn N" beside a conversation row is the INVESTIGATION turn.
 *
 * The symptom this removes (faultmaven#1329): ask for a haiku mid-incident and
 * the counter advances, because the label was the message clock. The clock is
 * still what ADDRESSES a turn — `data-turn`, and the `uploaded_at_turn` the
 * evidence surfaces feed `scrollToTurn` — so these tests pin both halves: the
 * label moved, the anchor did not.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('wxt/browser', () => ({
  browser: { tabs: { query: vi.fn(), sendMessage: vi.fn() } }
}));

const getCaseUI = vi.fn();
vi.mock('@faultmaven/copilot-ui/lib/api/case-service', () => ({
  caseApi: { getCaseUI: (...args: unknown[]) => getCaseUI(...args) }
}));

vi.mock('@faultmaven/copilot-ui/lib/api/files-service', () => ({
  filesApi: {
    getUploadedFiles: vi.fn().mockResolvedValue([
      {
        file_id: 'f-1',
        filename: 'checkout-pod.log',
        size_bytes: 2048,
        // The MESSAGE clock, which is what this field carries.
        uploaded_at_turn: 8,
        evidence_count: 0
      }
    ]),
    getUploadedFileDetails: vi.fn()
  }
}));

import { ChatWindow } from '@faultmaven/copilot-ui/shared/ui/components/ChatWindow';
import { ResolutionActionsCard } from '@faultmaven/copilot-ui/shared/ui/components/ResolutionActionsCard';
import { EvidenceDetailsModal } from '@faultmaven/copilot-ui/shared/ui/components/case-header/EvidenceDetailsModal';
import { CaseDetails } from '@faultmaven/copilot-ui/shared/ui/components/case-header/CaseDetails';
import { EnhancedCaseHeader } from '@faultmaven/copilot-ui/shared/ui/components/case-header/EnhancedCaseHeader';
import { createStubHost, hostWrapper } from '../support/host';
import type { UserCase } from '@faultmaven/copilot-ui/types/case';

const activeCase = {
  case_id: 'case-1',
  title: 'OOM kills on checkout',
  state: 'investigating',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  owner_id: 'user-1',
  enterprise_id: 'ent-1',
  closure_reason: null,
  closed_at: null
} as unknown as UserCase;

/**
 * Turn 7 is investigation work; turn 8 is the haiku. The backend labels both
 * rows of turn 8 with investigation turn 7 — the aside did not advance it.
 */
const conversation = [
  {
    id: 'm7-u',
    question: 'Here are the pod logs',
    timestamp: '2026-09-01T10:00:00Z',
    turn_number: 7,
    investigation_turn: 7,
    optimistic: false
  },
  {
    id: 'm7-a',
    response: 'The OOM killer fired on the checkout pod.',
    timestamp: '2026-09-01T10:00:05Z',
    turn_number: 7,
    investigation_turn: 7,
    optimistic: false
  },
  {
    id: 'm8-u',
    question: 'Forget the server — write me a haiku about a sleepy cat',
    timestamp: '2026-09-01T10:05:00Z',
    turn_number: 8,
    investigation_turn: 7,
    optimistic: false
  },
  {
    id: 'm8-a',
    response: 'Warm sun on the sill…',
    timestamp: '2026-09-01T10:05:03Z',
    turn_number: 8,
    investigation_turn: 7,
    optimistic: false
  }
] as any[];

const renderChat = (conv: any[] = conversation) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatWindow
        conversation={conv}
        activeCase={activeCase}
        loading={false}
        sessionId="sid-1"
        onQuerySubmit={vi.fn()}
      />
    </QueryClientProvider>
  );
};

describe('ChatWindow — the turn label', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCaseUI.mockResolvedValue({
      state: 'investigating',
      case_id: 'case-1',
      current_turn: 8,
      investigation_turn: 7
    });
  });

  it('labels an aside with the turn the investigation is still on', () => {
    // The regression in one assertion: before this change the haiku rows read
    // "Turn 8", which is what the user in #1329 reported.
    renderChat();

    expect(screen.getAllByText(/Turn 7 ·/).length).toBe(4);
    expect(screen.queryByText(/Turn 8 ·/)).toBeNull();
  });

  it('keeps data-turn on the message clock so jump-to-turn still works', () => {
    // `scrollToTurn` queries `[data-turn="N"]` and is fed `uploaded_at_turn`
    // from EvidenceDetailsModal and CaseDetails, which is the message clock.
    // Re-basing the anchor to match the label breaks that with no error and no
    // other failing test — so it is asserted here, beside the label it differs
    // from.
    const { container } = renderChat();

    const anchors = Array.from(container.querySelectorAll('[data-turn]')).map((el) =>
      el.getAttribute('data-turn')
    );
    expect(anchors).toEqual(['7', '8']);
    expect(container.querySelector('[data-turn="8"]')).not.toBeNull();
  });

  it('falls back to the message clock when the server sends no investigation turn', () => {
    // An older backend, or a row this client minted and has not reconciled.
    renderChat([
      {
        id: 'm3-u',
        question: 'what changed at 14:00?',
        timestamp: '2026-09-01T10:00:00Z',
        turn_number: 3,
        optimistic: false
      }
    ]);

    expect(screen.getAllByText(/Turn 3 ·/).length).toBe(1);
  });

  it('prints no turn for an aside that precedes the investigation', () => {
    // A bare greeting on a fresh case is out-of-band, so it sits at
    // investigation turn 0. There is no turn to name yet, and "Turn 0" would
    // be worse than silence.
    const { container } = renderChat([
      {
        id: 'm1-u',
        question: 'hi',
        timestamp: '2026-09-01T10:00:00Z',
        turn_number: 1,
        investigation_turn: 0,
        optimistic: false
      }
    ]);

    expect(container.textContent).not.toMatch(/Turn \d/);
    // …and the row is still addressable.
    expect(container.querySelector('[data-turn="1"]')).not.toBeNull();
  });

  it('names no turn in the header either when the investigation has had none', async () => {
    // A case whose only exchange was a greeting sits at investigation turn 0.
    // ChatWindow drops the row label at 0 — there is no turn to name yet — so
    // the header must not print `T0` one line above it. One value, one
    // reading, or this release re-creates its own defect in miniature.
    getCaseUI.mockResolvedValue({
      state: 'investigating',
      case_id: 'case-1',
      current_turn: 1,
      investigation_turn: 0
    });

    const { container } = renderChat([
      {
        id: 'm1-u',
        question: 'hi',
        timestamp: '2026-09-01T10:00:00Z',
        turn_number: 1,
        investigation_turn: 0,
        optimistic: false
      }
    ]);

    await waitFor(() => expect(getCaseUI).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toContain('Investigating'));
    expect(container.textContent).not.toMatch(/\bT0\b/);
    expect(container.textContent).not.toMatch(/Turn \d/);
  });

  it('shows the investigation turn in the case header, not the clock', async () => {
    // The same defect on the other surface: the header's "T8" is the
    // `State: investigating Turn 8` of #1329 read off the chrome.
    const { container } = renderChat();

    expect(await screen.findByText('T7')).toBeTruthy();
    expect(container.textContent).not.toContain('T8');
  });
});

/**
 * The third surface that printed the message clock: the resolution summary's
 * "N turns", which is how long the investigation took. An aside is not
 * investigation effort, so it must not inflate the tally.
 */
describe('ResolutionActionsCard — how many turns it took', () => {
  const resolvedCase = {
    ...activeCase,
    state: 'resolved',
    resolved_at: '2026-09-01T11:00:00Z'
  } as unknown as UserCase;

  const caseData = {
    state: 'resolved',
    case_id: 'case-1',
    current_turn: 12,
    investigation_turn: 9,
    root_cause: { description: 'Checkout pod memory limit too low' }
  } as any;

  it('counts investigation turns, not the message clock', () => {
    const { container } = render(
      <ResolutionActionsCard activeCase={resolvedCase} caseData={caseData} />
    );
    expect(container.textContent).toContain('9 turns');
    expect(container.textContent).not.toContain('12 turns');
  });

  it('falls back to the clock when the server sends no investigation turn', () => {
    const { container } = render(
      <ResolutionActionsCard
        activeCase={resolvedCase}
        caseData={{ ...caseData, investigation_turn: undefined }}
      />
    );
    expect(container.textContent).toContain('12 turns');
  });
});

/**
 * The evidence surfaces name a turn they do not render. They carry
 * `uploaded_at_turn`, which is the MESSAGE clock, so without a resolver they
 * print a different number than the conversation prints for the same
 * exchange — on the same screen, on any case with an aside.
 */
describe('EvidenceDetailsModal — the turn a file arrived on', () => {
  const evidenceDetails = {
    filename: 'checkout-pod.log',
    uploaded_at_turn: 9,
    derived_evidence: []
  } as any;

  const renderModal = (props: Record<string, unknown> = {}) =>
    render(
      <EvidenceDetailsModal
        isOpen
        evidenceDetails={evidenceDetails}
        evidenceLoading={false}
        onClose={vi.fn()}
        {...props}
      />
    );

  it('prints the investigation turn the conversation prints', () => {
    // Turn 9 of the conversation is turn 8 of the investigation.
    const { container } = renderModal({ turnLabel: (t: number) => (t === 9 ? 8 : t) });
    expect(container.textContent).toContain('Uploaded at Turn 8');
    expect(container.textContent).not.toContain('Uploaded at Turn 9');
  });

  it('jumps by the MESSAGE clock even though it labels by the other one', () => {
    // The load-bearing half: `scrollToTurn` queries `[data-turn="N"]`, which is
    // stamped with `turn_number`. Handing it the label would scroll to the
    // wrong row, or to none.
    const onScrollToTurn = vi.fn();
    const { getByTitle } = renderModal({
      turnLabel: (t: number) => (t === 9 ? 8 : t),
      onScrollToTurn
    });

    getByTitle('Jump to turn in conversation').click();
    expect(onScrollToTurn).toHaveBeenCalledWith(9);
  });

  it('names no turn at all when the conversation does not hold that row', () => {
    // Falling back to the clock would print the OTHER counter without saying
    // so — and, because the files list can render before the conversation
    // delta fetch resolves, the number would then change in place once the
    // rows arrive. A label that appears is fine; one that renumbers is the
    // defect this release is about.
    const { container, getByTitle } = renderModal({
      turnLabel: () => undefined,
      onScrollToTurn: vi.fn()
    });

    expect(container.textContent).not.toMatch(/Turn \d/);
    expect(container.textContent).not.toContain('Uploaded at');
    // The jump affordance survives, because the clock is still known.
    expect(getByTitle('Jump to turn in conversation')).toBeTruthy();
  });

  it('names no turn when mounted without a resolver', () => {
    const { container } = renderModal();
    expect(container.textContent).not.toMatch(/Turn \d/);
  });
});

/**
 * The file list's jump chip, and the prop path that feeds it. The review of
 * this PR found three CI-green mutations here: reverting the chip to the raw
 * clock, and dropping `turnLabel` at either of the two forwarding hops.
 */
describe('CaseDetails — the file list jump chip', () => {
  const caseData = {
    state: 'investigating',
    case_id: 'case-1',
    current_turn: 9,
    investigation_turn: 8,
    title: 'OOM kills on checkout',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    // Only the shape CaseDetails reads on the INVESTIGATING branch; the file
    // list below it is what these tests are about.
    progress: { completed_indicators: [], completed_milestones: [] },
    uploaded_files_count: 1,
    agent_status: 'idle'
  } as any;

  const renderDetails = (props: Record<string, unknown> = {}) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stub = createStubHost();
    return render(
      <QueryClientProvider client={queryClient}>
        <CaseDetails
          caseData={caseData}
          activeCase={activeCase}
          expandedSection="files"
          onToggleSection={vi.fn()}
          {...props}
        />
      </QueryClientProvider>,
      { wrapper: hostWrapper(stub.host) }
    );
  };

  it('labels the chip with the investigation turn', async () => {
    const { findByTitle } = renderDetails({
      onScrollToTurn: vi.fn(),
      turnLabel: (t: number) => (t === 8 ? 7 : t)
    });
    expect((await findByTitle('Jump to turn')).textContent).toBe('→ T7');
  });

  it('jumps by the message clock', async () => {
    const onScrollToTurn = vi.fn();
    const { findByTitle } = renderDetails({
      onScrollToTurn,
      turnLabel: (t: number) => (t === 8 ? 7 : t)
    });
    (await findByTitle('Jump to turn')).click();
    // The LABEL said 7; the jump must still use the clock.
    expect(onScrollToTurn).toHaveBeenCalledWith(8);
  });

  it('names no turn when the conversation does not hold that row', async () => {
    const { findByTitle } = renderDetails({
      onScrollToTurn: vi.fn(),
      turnLabel: () => undefined
    });
    const chip = await findByTitle('Jump to turn');
    expect(chip.textContent).not.toMatch(/T\d/);
    // …and still jumps.
    expect(chip.textContent).toBe('→ chat');
  });
});

/**
 * The prop path itself. The component tests above hand `turnLabel` straight to
 * the surface that uses it, so they stay green if either forwarding hop is
 * deleted — the review of this PR found exactly that. These two cover the
 * hops: ChatWindow → EnhancedCaseHeader, and EnhancedCaseHeader → CaseDetails.
 */
describe('the turnLabel prop path', () => {
  /**
   * End to end through both forwarding hops — ChatWindow →
   * EnhancedCaseHeader → CaseDetails — because the component tests above hand
   * the resolver straight to its consumer and so stay green if either hop is
   * deleted. That is precisely what the review of this PR found.
   */
  it('reaches the file list from ChatWindow, through the header', async () => {
    // The header gates its Files row on `uploaded_files_count`, and CaseDetails
    // reads `progress` on the INVESTIGATING branch.
    getCaseUI.mockResolvedValue({
      state: 'investigating',
      case_id: 'case-1',
      current_turn: 8,
      investigation_turn: 7,
      title: 'OOM kills on checkout',
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
      progress: { completed_indicators: [], completed_milestones: [] },
      uploaded_files_count: 1,
      agent_status: 'idle'
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stub = createStubHost();
    const { getByText, getByLabelText, findByTitle } = render(
      <QueryClientProvider client={queryClient}>
        <ChatWindow
          conversation={conversation}
          activeCase={activeCase}
          loading={false}
          sessionId="sid-1"
          onQuerySubmit={vi.fn()}
        />
      </QueryClientProvider>,
      { wrapper: hostWrapper(stub.host) }
    );

    // ChatWindow mounts the header collapsed (`initialExpanded={false}`), so
    // open it, then open the Files drill-down inside it.
    (await waitFor(() => getByLabelText('Expand details'))).click();
    (await waitFor(() => getByText('Files'))).click();

    // The mocked file landed on clock turn 8 — the aside — which the
    // conversation labels 7. A dropped forward at either hop shows '→ chat'.
    expect((await findByTitle('Jump to turn')).textContent).toBe('→ T7');
  });
});
