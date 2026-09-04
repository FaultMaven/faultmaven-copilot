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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CopilotPanel, type InitialCase } from '@faultmaven/copilot-ui';
import { webHostAdapter } from './web-host';
import { STUB_CASE_ID } from './stub-backend';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

/** `?case=new` | `?case=<id>` → what to hand the panel. Absent → nothing. */
export function readInitialCaseFromQuery(search: string): InitialCase | null {
  const value = new URLSearchParams(search).get('case');
  if (!value) return null;
  if (value === 'new') return { kind: 'new' };
  return { kind: 'existing', caseId: value === 'existing' ? STUB_CASE_ID : value };
}

export function PanelProof({ initialCase }: { initialCase: InitialCase }) {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen bg-fm-base text-fm-text-primary font-fm-sans flex flex-col">
        <header className="px-4 py-2 border-b border-fm-border text-fm-body text-fm-text-tertiary">
          <span data-testid="panel-proof-mode">
            {initialCase.kind === 'new'
              ? 'CopilotPanel, opened on a NEW investigation'
              : `CopilotPanel, opened on case ${initialCase.caseId}`}
          </span>{' '}
          — the host said so with a prop, and touched no storage to do it.
        </header>
        <div className="flex-1 min-h-0" data-testid="copilot-panel">
          <CopilotPanel host={webHostAdapter} initialCase={initialCase} />
        </div>
      </div>
    </QueryClientProvider>
  );
}
