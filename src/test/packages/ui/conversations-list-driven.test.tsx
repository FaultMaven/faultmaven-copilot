/**
 * The extension's case list is the cases its user DRIVES (ADR-020 D8, fm#1898).
 *
 * The sidebar asks for `access=write`, so every row is drivable: no "Shared"
 * mark, rename and title generation on every row (the driver's writes), and
 * delete only where the viewer is the CREATOR (governance, ADR-020 D2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import ConversationsList from '@faultmaven/copilot-ui/shared/ui/components/ConversationsList';
import { useAppStore } from '@faultmaven/copilot-ui/lib/state/store';
import { caseCacheManager } from '@faultmaven/copilot-ui/lib/cache/case-cache';
import { applyWriteRefused } from '@faultmaven/copilot-ui/lib/state/write-refused';
import { getEpoch } from '@faultmaven/copilot-ui/lib/state/session-epoch';

const { getUserCases } = vi.hoisted(() => ({ getUserCases: vi.fn() }));
vi.mock('@faultmaven/copilot-ui/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@faultmaven/copilot-ui/lib/api')>()),
  getUserCases,
}));

const caseRow = (id: string, title: string, creator: string, driver: string) => ({
  case_id: id,
  title,
  state: 'investigating',
  created_at: '2026-10-09T09:00:00Z',
  updated_at: '2026-10-09T09:00:00Z',
  owner_id: creator,
  driver_id: driver,
  enterprise_id: 'e1',
  organization_id: null,
  closure_reason: null,
  closed_at: null,
});

const MINE = caseRow('c-mine', 'My disk pressure', 'u1', 'u1');
// Created by a teammate, handed to the viewer: theirs to delete, ours to drive.
const HANDED = caseRow('c-handed', 'Handed pool exhaustion', 'u2', 'u1');

beforeEach(() => {
  vi.clearAllMocks();
  getUserCases.mockResolvedValue([MINE, HANDED]);
});

const renderList = (currentUserId: string | undefined) =>
  render(
    <ConversationsList
      onCaseSelect={() => {}}
      onNewSession={() => {}}
      currentUserId={currentUserId}
    />,
  );

const openMenu = (title: string) =>
  fireEvent.click(screen.getByRole('button', { name: `Menu for ${title}` }));

describe('ConversationsList — the cases this user drives', () => {
  it('asks for the cases the user can WRITE, first page', async () => {
    renderList('u1');
    await screen.findByText('My disk pressure');
    expect(getUserCases).toHaveBeenCalledWith({ access: 'write', limit: 100, offset: 0 });
  });

  it('marks no row "Shared": every listed case is drivable', async () => {
    renderList('u1');
    await screen.findByText('Handed pool exhaustion');
    expect(screen.queryByText('Shared')).toBeNull();
  });

  it('hands only the case id to onCaseSelect', async () => {
    const onCaseSelect = vi.fn();
    render(<ConversationsList onCaseSelect={onCaseSelect} onNewSession={() => {}} currentUserId="u1" />);
    fireEvent.click(await screen.findByText('Handed pool exhaustion'));
    expect(onCaseSelect).toHaveBeenCalledTimes(1);
    expect(onCaseSelect.mock.calls[0]).toEqual(['c-handed']);
  });

  it('offers delete on a case the viewer created', async () => {
    renderList('u1');
    await screen.findByText('My disk pressure');
    openMenu('My disk pressure');
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Generate title')).toBeInTheDocument();
  });

  it('offers no delete on a case the viewer drives but did not create; rename stays', async () => {
    renderList('u1');
    await screen.findByText('Handed pool exhaustion');
    openMenu('Handed pool exhaustion');
    expect(screen.queryByText('Delete')).toBeNull();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Generate title')).toBeInTheDocument();
  });

  it('offers no delete when the viewer is unknown', async () => {
    renderList(undefined);
    await screen.findByText('My disk pressure');
    openMenu('My disk pressure');
    expect(screen.queryByText('Delete')).toBeNull();
  });

});

describe('ConversationsList — a case reassigned away drops out', () => {
  // The sidebar wired to the store's refresh counter, as CollapsibleNavigation does.
  function WiredList() {
    const refresh = useAppStore((s) => s.refreshSessions);
    return (
      <ConversationsList
        onCaseSelect={() => {}}
        onNewSession={() => {}}
        currentUserId="u1"
        refreshTrigger={refresh}
      />
    );
  }

  it('a 403 whose read-back names another driver removes the case from the list, through a fresh read', async () => {
    const order: string[] = [];
    const invalidate = vi.spyOn(caseCacheManager, 'invalidateCache').mockImplementation(async () => {
      order.push('invalidate');
    });
    getUserCases.mockImplementation(async () => {
      order.push('list');
      return order.includes('invalidate') ? [HANDED] : [MINE, HANDED];
    });
    useAppStore.setState({
      currentUser: { id: 'u1', username: 'me', roles: [] } as never,
      writeDeniedCaseIds: {},
      refreshActiveCase: vi.fn(async () => ({ ...MINE, driver_id: 'u2' })),
    } as never);

    render(<WiredList />);
    expect(await screen.findByText('My disk pressure')).toBeInTheDocument();

    const setConversations = vi.fn();
    await act(async () => {
      applyWriteRefused({
        caseId: 'c-mine',
        aiMessageId: 'ai-1',
        fallbackText: 'refused',
        epoch: getEpoch(),
        setConversations,
      });
    });

    await waitFor(() => expect(screen.queryByText('My disk pressure')).toBeNull());
    expect(screen.getByText('Handed pool exhaustion')).toBeInTheDocument();
    // The slot is dropped BEFORE the reload, so the reload is not served the cached page.
    expect(order).toEqual(['list', 'invalidate', 'list']);
    expect(useAppStore.getState().writeDeniedCaseIds['c-mine']).toBe(true);
    invalidate.mockRestore();
  });

  it('a 403 whose read-back names the viewer leaves the list alone', async () => {
    const invalidate = vi.spyOn(caseCacheManager, 'invalidateCache').mockResolvedValue();
    useAppStore.setState({
      currentUser: { id: 'u1', username: 'me', roles: [] } as never,
      writeDeniedCaseIds: {},
      refreshActiveCase: vi.fn(async () => MINE),
    } as never);

    render(<WiredList />);
    await screen.findByText('My disk pressure');
    const before = useAppStore.getState().refreshSessions;
    const listCalls = getUserCases.mock.calls.length;

    await act(async () => {
      applyWriteRefused({
        caseId: 'c-mine',
        aiMessageId: 'ai-1',
        fallbackText: 'refused',
        epoch: getEpoch(),
        setConversations: vi.fn(),
      });
    });

    expect(useAppStore.getState().refreshSessions).toBe(before);
    expect(invalidate).not.toHaveBeenCalled();
    expect(getUserCases).toHaveBeenCalledTimes(listCalls);
    expect(screen.getByText('My disk pressure')).toBeInTheDocument();
    invalidate.mockRestore();
  });
});
