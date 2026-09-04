/**
 * The proof: the EXISTING Copilot chat UI, rendered in a plain Vite page.
 *
 * No extension context, no manifest, no service worker, no `browser` global —
 * `ChatInterface`, `ChatWindow` and `UnifiedInputBar` are imported unmodified
 * from `src/shared/ui` and mounted here over a stub `HostAdapter` and a stub
 * ALREADY-AUTHENTICATED session.
 *
 * What it demonstrates, and what it does not:
 *
 *  ✓ the chat UI renders and is interactive outside the extension;
 *  ✓ no sign-in appears — the session comes from the host, so the UI has no
 *    branch that could render one;
 *  ✓ the page-capture affordance stays VISIBLE and enabled, and explains
 *    itself when pressed;
 *  ✗ nothing talks to a backend. `sessionId` is null, which disables the one
 *    query `ChatWindow` issues, and the submit handlers echo locally.
 *
 * The extension APIs the UI still calls directly are answered by the
 * `wxt/browser` alias in vite.config.ts (see wxt-browser.ts). That alias is the
 * scaffold the migration removes, one call site at a time; it is not the
 * design.
 */
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatInterface } from '~/shared/ui/components/ChatInterface';
import { HostAdapterProvider } from '~/shared/host';
import type { OptimisticConversationItem, PendingOperation } from '~/lib/optimistic';
import type { UserCase } from '~/types/case';
import { webHostAdapter } from './web-host';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const STUB_CASE: UserCase = {
  case_id: 'case_playground_0001',
  title: 'Pods evicted on worker-03 after a disk-pressure taint',
  state: 'investigating',
  created_at: new Date(Date.now() - 36 * 60 * 1000).toISOString(),
  updated_at: new Date().toISOString(),
  description: 'Stub case. Nothing here reaches a backend.',
  owner_id: 'stub-user',
  organization_id: 'stub-org',
  closure_reason: null,
  closed_at: null,
};

const INITIAL_CONVERSATION: OptimisticConversationItem[] = [
  {
    id: 'turn-1',
    question: 'Half the pods on worker-03 went Evicted about 20 minutes ago.',
    response:
      'Eviction on a single node points at a **node-local** resource, not the workload.\n\n' +
      'The kubelet evicts when it sets a pressure taint, so the first thing to separate is ' +
      '*which* pressure fired.\n\n' +
      '- `kubectl describe node worker-03` — read the `Conditions` and `Taints` blocks\n' +
      '- `df -h /var/lib/kubelet` on the node itself\n\n' +
      'Paste either one back and I will narrow it.',
    timestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    optimistic: false,
  },
];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1 border-b border-fm-border-subtle last:border-b-0">
      <div className="w-44 shrink-0 text-fm-text-tertiary">{label}</div>
      <div className="text-fm-text-secondary">{value}</div>
    </div>
  );
}

export default function App() {
  const [conversation, setConversation] = useState(INITIAL_CONVERSATION);
  const host = webHostAdapter;

  const echo = (question: string) => {
    const stamp = Date.now();
    setConversation((prev) => [
      ...prev,
      {
        id: `turn-${stamp}`,
        question,
        response:
          'This host has no backend. The turn was rendered locally to show that ' +
          'the input bar, the optimistic append and the transcript all work with ' +
          'zero extension APIs underneath them.',
        timestamp: new Date().toISOString(),
        optimistic: false,
      },
    ]);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <HostAdapterProvider value={host}>
        <div className="min-h-screen bg-fm-base text-fm-text-primary font-fm-sans p-6 flex flex-col gap-6 items-center">
          <header className="w-full max-w-fm-content">
            <h1 className="text-fm-title font-semibold">Copilot UI — web host proof</h1>
            <p className="text-fm-body text-fm-text-tertiary mt-1">
              <code className="font-fm-mono text-fm-code">src/shared/ui</code>, unmodified, in a
              plain Vite page. Host kind: <strong>{host.kind}</strong>. Signed in as{' '}
              <strong>{host.session.user.displayName}</strong> — supplied by the host, so no
              sign-in screen exists in this tree.
            </p>
          </header>

          <div
            className="w-full max-w-fm-content h-[560px] bg-fm-canvas border border-fm-border rounded-fm-card overflow-hidden flex flex-col"
            data-testid="copilot-panel"
          >
            <ChatInterface
              activeCaseId={STUB_CASE.case_id}
              activeCase={STUB_CASE}
              conversations={{ [STUB_CASE.case_id]: conversation }}
              loading={false}
              submitting={false}
              /* null disables ChatWindow's only network query. */
              sessionId={null}
              hasUnsavedNewChat={false}
              onQuerySubmit={async (query: string) => echo(query)}
              onTurnSubmit={async () => ({ success: true, message: 'stub host: nothing sent' })}
              failedOperations={[] as PendingOperation[]}
              onRetryFailedOperation={() => {}}
              onDismissFailedOperation={() => {}}
              getErrorMessageForOperation={() => ({
                title: '',
                message: '',
                recoveryHint: '',
              })}
            />
          </div>

          <section className="w-full max-w-fm-content bg-fm-surface border border-fm-border rounded-fm-card p-4 text-fm-body">
            <h2 className="text-fm-title font-semibold mb-2">What this host answers</h2>
            <Row label="store" value="localStorage, namespaced — get / set / remove / subscribe" />
            <Row label="endpoints" value="the origin that served the page; subscribe never fires" />
            <Row label="navigation.dashboard" value="router push — this page IS the dashboard" />
            <Row
              label="navigation.settings"
              value={<em>null — no options page, so no affordance is rendered</em>}
            />
            <Row label="session" value="handed in, non-nullable; signOut is the host's" />
            <Row
              label="pageCapture"
              value={
                host.pageCapture.supported ? (
                  'supported'
                ) : (
                  <>
                    <div>{host.pageCapture.reason}</div>
                    <a
                      className="text-fm-accent hover:underline"
                      href={host.pageCapture.installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Install the Copilot extension →
                    </a>
                  </>
                )
              }
            />
            <p className="text-fm-sm text-fm-text-tertiary mt-3">
              The capture button in the panel above is visible and enabled. Pressing it reads{' '}
              <code className="font-fm-mono">host.pageCapture</code>, finds the{' '}
              <code className="font-fm-mono">supported: false</code> arm, and renders the reason
              above together with the install link — no extension API is reached.
            </p>
          </section>
        </div>
      </HostAdapterProvider>
    </QueryClientProvider>
  );
}
