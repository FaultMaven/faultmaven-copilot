/**
 * The whole panel, in a web page, opened on what the host asked for.
 *
 * `App.tsx` proves the transcript renders outside an extension. This proves the
 * thing a real host actually does: mount `CopilotPanel` and tell it what to
 * show. Before `initialCase` a host could only say that by writing the store's
 * storage keys behind the panel's back.
 *
 *   ?case=new          land on the composer, with an investigation open
 *   ?case=<case id>    land on that case's transcript
 *
 * Everything it talks to is `stub-backend.ts`.
 */
import { CopilotPanel, type InitialCase, type PanelChrome } from '@faultmaven/copilot-ui';
import { webHostAdapter } from './web-host';
import { STUB_CASE_ID } from './stub-backend';

/** `?chrome=embedded` → the conversation alone, as a Dashboard page embeds it. */
export function readChromeFromQuery(search: string): PanelChrome {
  return new URLSearchParams(search).get('chrome') === 'embedded' ? 'embedded' : 'full';
}

/** `?case=new` | `?case=<id>` → what to hand the panel. Absent → nothing. */
export function readInitialCaseFromQuery(search: string): InitialCase | null {
  const value = new URLSearchParams(search).get('case');
  if (!value) return null;
  if (value === 'new') return { kind: 'new' };
  return { kind: 'existing', caseId: value === 'existing' ? STUB_CASE_ID : value };
}

export function PanelProof({
  initialCase,
  chrome,
}: {
  initialCase: InitialCase;
  chrome: PanelChrome;
}) {
  return (
    <div className="h-screen bg-fm-base text-fm-text-primary font-fm-sans flex flex-col">
      <header className="px-4 py-2 border-b border-fm-border text-fm-body text-fm-text-tertiary">
        <span data-testid="panel-proof-mode">
          {initialCase.kind === 'new'
            ? 'CopilotPanel, opened on a NEW investigation'
            : `CopilotPanel, opened on case ${initialCase.caseId}`}
          {chrome === 'embedded' ? ', embedded' : ''}
        </span>{' '}
        — the host said so with props, and touched no storage to do it. No query
        client either: the panel brings its own.
      </header>
      <div className="flex-1 min-h-0" data-testid="copilot-panel">
        <CopilotPanel host={webHostAdapter} initialCase={initialCase} chrome={chrome} />
      </div>
    </div>
  );
}
