import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('wxt/browser', () => ({
  browser: { tabs: { query: vi.fn(), sendMessage: vi.fn() } }
}));

vi.mock('@faultmaven/copilot-ui/lib/api/case-service', () => ({
  caseApi: { getCaseUI: vi.fn().mockResolvedValue({ state: 'investigating' }) }
}));

import { ChatWindow } from '@faultmaven/copilot-ui/shared/ui/components/ChatWindow';
import { attachmentOrigin } from '@faultmaven/copilot-ui/lib/api/formatters';
import type { UserCase } from '@faultmaven/copilot-ui/types/case';

const activeCase = {
  case_id: 'case-1',
  title: 'Pod restart loop',
  state: 'investigating',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  owner_id: 'user-1',
  organization_id: 'org-1',
  closure_reason: null,
  closed_at: null
} as unknown as UserCase;

/**
 * Attachment rows as the backend sends them AFTER faultmaven#1198.
 *
 * Two things changed there and together they killed both of the icon's
 * signals: `filename` became a DISPLAY name (the route-minted
 * `pasted-content-*.txt` / `page-capture-*.txt` names stopped being sent), and
 * `source_type` was never an origin in the first place — it carries the
 * preprocessing data classification. `upload_source` is the field that has
 * always held the answer.
 */
const attachment = (over: Record<string, unknown> = {}) => ({
  evidence_id: `ev-${Math.random()}`,
  filename: 'pasted text (turn 3)',
  data_type: 'logs',
  file_size: 512,
  processing_status: 'completed',
  source_type: 'logs',
  upload_source: 'text_paste',
  ...over
});

const renderWith = (attachments: any[]) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const conversation = [
    {
      id: 'm1',
      question: 'here is the log',
      timestamp: '2026-08-01T10:00:00Z',
      turn_number: 3,
      optimistic: false,
      attachments
    }
  ] as any[];
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatWindow
        conversation={conversation}
        activeCase={activeCase}
        loading={false}
        sessionId="sid-1"
        onQuerySubmit={vi.fn()}
      />
    </QueryClientProvider>
  );
};

const origins = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-attachment-origin]')).map(
    (n) => n.getAttribute('data-attachment-origin')
  );

describe('attachmentOrigin', () => {
  it('reads the provenance tag, not the data classification', () => {
    // `source_type: 'logs'` is the DATA type. Reading it as an origin is what
    // made every comparison fall through.
    expect(attachmentOrigin({ upload_source: 'page_capture' })).toBe('page_capture');
    expect(attachmentOrigin({ upload_source: 'text_paste' })).toBe('text_paste');
    expect(attachmentOrigin({ upload_source: 'file_upload' })).toBe('file_upload');
  });

  it('accepts both paste spellings', () => {
    // `UploadedFile.upload_source` carries "text_paste" from the turns route
    // and "paste" on older rows; a deduped re-submission returns the ORIGINAL
    // row's tag, so a current turn can surface either.
    expect(attachmentOrigin({ upload_source: 'paste' })).toBe('text_paste');
    expect(attachmentOrigin({ upload_source: 'text_paste' })).toBe('text_paste');
  });

  it('falls back to the minted filename prefix when no tag is present', () => {
    // Compatibility only — rows predating the tag values.
    expect(attachmentOrigin({ filename: 'page-capture-20260709T105531.txt' }))
      .toBe('page_capture');
    expect(attachmentOrigin({ filename: 'pasted-content-20260709T105531.txt' }))
      .toBe('text_paste');
  });

  it('prefers the tag over a contradicting filename', () => {
    // The precedence the backend's own `_is_paste_target` applies: tag first,
    // filename shape as the fallback signal.
    expect(
      attachmentOrigin({
        upload_source: 'file_upload',
        filename: 'pasted-content-20260709T105531.txt'
      })
    ).toBe('file_upload');
  });

  it('treats an unknown tag and a chosen file alike', () => {
    expect(attachmentOrigin({ upload_source: 'something_new' })).toBe('file_upload');
    expect(attachmentOrigin({ filename: 'app.log' })).toBe('file_upload');
    expect(attachmentOrigin({})).toBe('file_upload');
  });
});

describe('ChatWindow — attachment chip origin (#224)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks a paste as a paste even though the filename no longer says so', () => {
    // The regression: after faultmaven#1198 the filename is "pasted text
    // (turn 3)", so the prefix branch is dead, and `source_type` is 'logs',
    // so the tag branch never matched — every chip hit the paperclip.
    const { container } = renderWith([attachment()]);

    expect(origins(container)).toEqual(['text_paste']);
  });

  it('marks a page capture as a capture — the primary Copilot channel', () => {
    const { container } = renderWith([
      attachment({ filename: 'captured page (turn 2)', upload_source: 'page_capture' })
    ]);

    expect(origins(container)).toEqual(['page_capture']);
  });

  it('leaves a genuinely chosen file on the file origin', () => {
    const { container } = renderWith([
      attachment({ filename: 'app.log', upload_source: 'file_upload', source_type: 'logs' })
    ]);

    expect(origins(container)).toEqual(['file_upload']);
  });

  it('resolves each chip independently on a mixed turn', () => {
    const { container } = renderWith([
      attachment({ filename: 'app.log', upload_source: 'file_upload' }),
      attachment({ filename: 'pasted text (turn 3)', upload_source: 'text_paste' })
    ]);

    expect(origins(container)).toEqual(['file_upload', 'text_paste']);
  });
});
