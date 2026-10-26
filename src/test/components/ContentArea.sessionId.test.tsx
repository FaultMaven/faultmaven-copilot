/**
 * `ContentArea` follows the session id (faultmaven#1460, F2 of
 * faultmaven-dashboard#255's review). A session minted after mount changes only
 * `sessionId`, and the case header's query keys on it: a memo that ignored it
 * left that query keyed on `null`.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const chat = vi.hoisted(() => ({ sessionIds: [] as Array<string | null> }));
vi.mock('@faultmaven/copilot-ui/shared/ui/components/ChatInterface', () => ({
  ChatInterface: (props: { sessionId: string | null }) => {
    chat.sessionIds.push(props.sessionId);
    return null;
  },
}));

import { ContentArea, type ContentAreaProps } from '@faultmaven/copilot-ui/shared/ui/layouts/ContentArea';
import type { UserCase } from '@faultmaven/copilot-ui/types/case';

const activeCase = { case_id: 'case-1', state: 'investigating' } as unknown as UserCase;
const noop = () => {};
const props: ContentAreaProps = {
  activeTab: 'copilot',
  activeCaseId: 'case-1',
  activeCase,
  conversations: {},
  loading: false,
  submitting: false,
  sessionId: null,
  hasUnsavedNewChat: false,
  failedOperations: [],
  onQuerySubmit: vi.fn(),
  onTurnSubmit: vi.fn(),
  onNewChat: noop,
  onRetryFailedOperation: noop,
  onDismissFailedOperation: noop,
  getErrorMessageForOperation: () => ({ title: '', message: '', recoveryHint: '' }),
};

describe('ContentArea', () => {
  it('passes a session id that arrives after mount to the chat', () => {
    const { rerender } = render(<ContentArea {...props} />);
    expect(chat.sessionIds.at(-1)).toBeNull();

    rerender(<ContentArea {...props} sessionId="sess-1" />);

    expect(chat.sessionIds.at(-1)).toBe('sess-1');
  });
});
