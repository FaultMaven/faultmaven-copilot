/**
 * The case list keeps a teammate's case visible and marks it (fm#1898).
 *
 * Kept, not filtered: the ruling is "show non-owned cases read-only". The row
 * carries the same owner-only restriction the server enforces — no rename, title
 * generation or delete — so the menu never offers a write that returns a 403.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import ConversationsList from '@faultmaven/copilot-ui/shared/ui/components/ConversationsList';

const { getUserCases } = vi.hoisted(() => ({ getUserCases: vi.fn() }));
vi.mock('@faultmaven/copilot-ui/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@faultmaven/copilot-ui/lib/api')>()),
  getUserCases,
}));

const caseRow = (id: string, title: string, owner: string) => ({
  case_id: id,
  title,
  state: 'investigating',
  created_at: '2026-10-09T09:00:00Z',
  updated_at: '2026-10-09T09:00:00Z',
  owner_id: owner,
  enterprise_id: 'e1',
  organization_id: null,
  closure_reason: null,
  closed_at: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  getUserCases.mockResolvedValue([
    caseRow('c-mine', 'My disk pressure', 'u1'),
    caseRow('c-theirs', 'Their pool exhaustion', 'u2'),
  ]);
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

describe('ConversationsList — shared cases', () => {
  // The placeholder row names the owner before hydration, so a failed read
  // cannot leave a shared case with a live composer.
  it('hands the row’s owner to onCaseSelect', async () => {
    const onCaseSelect = vi.fn();
    render(<ConversationsList onCaseSelect={onCaseSelect} onNewSession={() => {}} currentUserId="u1" />);
    fireEvent.click(await screen.findByText('Their pool exhaustion'));
    expect(onCaseSelect).toHaveBeenCalledWith('c-theirs', 'u2');
  });

  it('keeps both rows and marks only the one another user owns', async () => {
    renderList('u1');

    expect(await screen.findByText('Their pool exhaustion')).toBeInTheDocument();
    expect(screen.getByText('My disk pressure')).toBeInTheDocument();
    expect(screen.getAllByText('Shared')).toHaveLength(1);
    const theirs = screen.getByText('Their pool exhaustion').closest('[role="button"]')!;
    expect(theirs).toHaveTextContent('Shared');
  });

  it('offers no rename, title generation or delete on a shared row', async () => {
    renderList('u1');
    await screen.findByText('Their pool exhaustion');

    openMenu('Their pool exhaustion');
    expect(screen.queryByText('Rename')).toBeNull();
    expect(screen.queryByText('Generate title')).toBeNull();
    expect(screen.queryByText('Delete')).toBeNull();
  });

  it('still offers them on the viewer’s own row', async () => {
    renderList('u1');
    await screen.findByText('My disk pressure');

    openMenu('My disk pressure');
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('re-evaluates for a different signed-in user: the same rows, the marks swap', async () => {
    renderList('u2');
    await screen.findByText('My disk pressure');

    const mine = screen.getByText('My disk pressure').closest('[role="button"]')!;
    expect(mine).toHaveTextContent('Shared');
    expect(screen.getByText('Their pool exhaustion').closest('[role="button"]')).not.toHaveTextContent('Shared');
  });
});
