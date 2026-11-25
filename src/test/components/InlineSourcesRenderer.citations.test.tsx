import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import InlineSourcesRenderer from '@faultmaven/copilot-ui/shared/ui/components/InlineSourcesRenderer';
import type { Source } from '@faultmaven/copilot-ui/lib/api';

// Sources exactly as the backend's KB pre-fetch emits them
// (`_kb_context_sources`): the excerpt as `content`, the retrieval score as
// `confidence`, and the runbook's id and title under `metadata`.
const kb = (n: number, over: Partial<Source> = {}): Source => ({
  type: 'knowledge_base',
  content: `Excerpt ${n}.`,
  confidence: 0.82,
  metadata: { document_id: `doc-${n}`, title: `Runbook ${n}`, trigger: 'symptom' },
  ...over,
});

describe('InlineSourcesRenderer — runbooks in context', () => {
  it('lists every source under the reply, whatever shape the reply takes', () => {
    // A reply of bullets and a heading has no paragraph to pin a marker to.
    render(
      <InlineSourcesRenderer
        content={'## Steps\n\n- rotate the secret\n- restart the pods'}
        sources={[kb(1), kb(2), kb(3), kb(4)]}
      />
    );

    expect(screen.getByText('📚 4 runbooks in context')).toBeInTheDocument();
    for (const n of [1, 2, 3, 4]) {
      expect(screen.getByText(`Runbook ${n}`)).toBeInTheDocument();
    }
  });

  it('shows each source\'s kind, relevance and verification status', () => {
    render(
      <InlineSourcesRenderer content="Done." sources={[kb(1, { verification_status: 'verified' })]} />
    );

    expect(screen.getByText(/Knowledge Base/)).toBeInTheDocument();
    expect(screen.getByText('82% relevance')).toBeInTheDocument();
    expect(screen.getByText(/verified/)).toBeInTheDocument();
  });

  it('opens a runbook from a real button, without hovering', () => {
    const onDocumentView = vi.fn();
    render(<InlineSourcesRenderer content="Done." sources={[kb(1)]} onDocumentView={onDocumentView} />);

    const open = screen.getByRole('button', { name: /Open runbook/ });
    fireEvent.click(open);
    expect(onDocumentView).toHaveBeenCalledWith('doc-1');
  });

  it('falls back to a numbered title and no link when metadata is null', () => {
    render(
      <InlineSourcesRenderer content="Done." sources={[kb(1, { metadata: null })]} onDocumentView={vi.fn()} />
    );

    expect(screen.getByText('Source 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open runbook/ })).not.toBeInTheDocument();
  });

  it('pins no marker to the reply text', () => {
    render(<InlineSourcesRenderer content="Based on the runbook, rotate the secret now." sources={[kb(1)]} />);
    expect(screen.queryByText('[1]')).not.toBeInTheDocument();
  });

  // The markdown components are element TYPES to react-markdown; rebuilt per
  // render, they remounted every paragraph on any parent re-render.
  it('keeps the rendered markdown mounted across a re-render', () => {
    const { rerender } = render(
      <InlineSourcesRenderer content="A paragraph that stays put." sources={[]} onDocumentView={vi.fn()} />
    );
    const before = screen.getByText('A paragraph that stays put.');

    rerender(<InlineSourcesRenderer content="A paragraph that stays put." sources={[]} onDocumentView={vi.fn()} />);

    expect(screen.getByText('A paragraph that stays put.')).toBe(before);
  });

  it('renders no list when there are no sources', () => {
    render(<InlineSourcesRenderer content="Done." sources={[]} />);
    expect(screen.queryByText(/in context/)).not.toBeInTheDocument();
  });

  // Up to two sections of one runbook reach a turn's list; the summary names runbooks.
  it('counts runbooks, not sections', () => {
    render(
      <InlineSourcesRenderer
        content="Done."
        sources={[
          kb(1, { content: 'First section.' }),
          kb(1, { content: 'Second section.' }),
          kb(2),
        ]}
      />
    );

    expect(screen.getByText('📚 2 runbooks in context')).toBeInTheDocument();
    expect(screen.getByText('First section.')).toBeInTheDocument();
    expect(screen.getByText('Second section.')).toBeInTheDocument();
  });

  it('counts one runbook in the singular, however many sections it gave', () => {
    render(
      <InlineSourcesRenderer content="Done." sources={[kb(1, { content: 'A.' }), kb(1, { content: 'B.' })]} />
    );
    expect(screen.getByText('📚 1 runbook in context')).toBeInTheDocument();
  });
});

// Excerpts are the head of a runbook section, which is markdown — shaped as
// the server stores them (`### Cause B: …\n**Statement:** …`).
describe('InlineSourcesRenderer — a source excerpt', () => {
  it('renders its markdown rather than the raw syntax', () => {
    const { container } = render(
      <InlineSourcesRenderer
        content="Done."
        sources={[
          kb(1, {
            content:
              '### Cause B: Container is OOM-killed\n**Statement:** The `memory` limit is too low.\n\n- check `kubectl describe`\n- raise the limit...',
          }),
        ]}
      />
    );
    const card = container.querySelector('details') as HTMLElement;

    expect(card).not.toHaveTextContent('###');
    expect(card).not.toHaveTextContent('**');
    expect(screen.getByText('Cause B: Container is OOM-killed')).toBeInTheDocument();
    expect(screen.getByText('Statement:').tagName).toBe('STRONG');
    expect(screen.getByText('memory').tagName).toBe('CODE');
    expect(card.querySelectorAll('li li')).toHaveLength(2);
  });

  // An excerpt sits in a list item; its heading must not enter the page outline.
  it('demotes its heading to a bold line', () => {
    const { container } = render(
      <InlineSourcesRenderer content="Done." sources={[kb(1, { content: '## Symptom Recognition\n\nText.' })]} />
    );
    const card = container.querySelector('details') as HTMLElement;

    expect(card.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    expect(screen.getByText('Symptom Recognition').tagName).toBe('P');
  });

  it('renders an excerpt cut inside a code fence without losing the text', () => {
    render(<InlineSourcesRenderer content="Done." sources={[kb(1, { content: 'Run:\n\n```bash\nkubectl get po...' })]} />);
    expect(screen.getByText(/kubectl get po/)).toBeInTheDocument();
  });

  // The card is in the side panel and the Dashboard page: a followed link must not replace either.
  it('opens an absolute link in a new tab, and renders a relative one as its text', () => {
    const { container } = render(
      <InlineSourcesRenderer
        content="Done."
        sources={[kb(1, { content: 'See [the docs](https://kubernetes.io/docs/x) and [pool](../db/pool.md).' })]}
      />
    );
    const card = container.querySelector('details') as HTMLElement;
    const links = card.querySelectorAll('a');

    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://kubernetes.io/docs/x');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(card).toHaveTextContent('and pool.');
  });

  it('fetches no image from an excerpt', () => {
    const { container } = render(
      <InlineSourcesRenderer content="Done." sources={[kb(1, { content: 'Diagram: ![d](https://example.com/a.png)' })]} />
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('keeps a wide table inside a scroll box', () => {
    const { container } = render(
      <InlineSourcesRenderer content="Done." sources={[kb(1, { content: '| cmd | why |\n|---|---|\n| `kubectl top` | usage |' })]} />
    );
    const table = (container.querySelector('details') as HTMLElement).querySelector('table') as HTMLElement;
    expect(table.parentElement).toHaveClass('overflow-x-auto');
  });

  it('renders no script from an excerpt', () => {
    const { container } = render(
      <InlineSourcesRenderer content="Done." sources={[kb(1, { content: 'A <script>alert(1)</script> b' })]} />
    );
    expect(container.querySelector('script')).toBeNull();
  });
});

// One turn's list can hold the standing pre-fetched context beside what a
// search found for this turn (`metadata.trigger`, contract 14.24.0 and the
// `kb_qa` citation change).
describe('InlineSourcesRenderer — sources grouped by how they reached the prompt', () => {
  const withTrigger = (n: number, trigger: string): Source =>
    kb(n, { metadata: { document_id: `doc-${n}`, title: `Runbook ${n}`, trigger } });

  const sectionOf = (label: string): HTMLElement => screen.getByRole('group', { name: label });
  const groupLabels = (): string[] =>
    screen
      .getAllByRole('group')
      .map((g) => g.getAttribute('aria-label'))
      .filter((label): label is string => label !== null);

  it('separates a question lookup and the assistant\'s search from the standing context', () => {
    render(
      <InlineSourcesRenderer
        content="Done."
        sources={[
          withTrigger(1, 'symptom'),
          withTrigger(2, 'root_cause'),
          withTrigger(3, 'question'),
          withTrigger(4, 'kb_qa'),
        ]}
      />
    );

    // Labelled groups, not headings: the card adds nothing to the reply's outline.
    expect(screen.queryByRole('heading')).toBeNull();
    expect(groupLabels()).toEqual([
      'Found for your question',
      "From the assistant's knowledge-base search",
      'Matched to this case',
    ]);
    expect(within(sectionOf('Found for your question')).getByText('Runbook 3')).toBeInTheDocument();
    expect(
      within(sectionOf("From the assistant's knowledge-base search")).getByText('Runbook 4')
    ).toBeInTheDocument();
    const caseGroup = sectionOf('Matched to this case');
    expect(within(caseGroup).getByText('Runbook 1')).toBeInTheDocument();
    expect(within(caseGroup).getByText('Runbook 2')).toBeInTheDocument();
    expect(within(caseGroup).queryByText('Runbook 3')).toBeNull();
  });

  it('shows no group label when every source came one way', () => {
    render(<InlineSourcesRenderer content="Done." sources={[withTrigger(1, 'question'), withTrigger(2, 'question')]} />);
    expect(groupLabels()).toEqual([]);
    expect(screen.queryByText('Found for your question')).toBeNull();
  });

  it('files a trigger it does not know, or none, with the case context', () => {
    render(
      <InlineSourcesRenderer
        content="Done."
        sources={[withTrigger(1, 'question'), withTrigger(2, 'some_future_trigger'), kb(3, { metadata: null })]}
      />
    );

    const caseGroup = sectionOf('Matched to this case');
    expect(within(caseGroup).getByText('Runbook 2')).toBeInTheDocument();
    // Numbered down the card as shown: Runbook 1 (question group), Runbook 2, then this.
    expect(within(caseGroup).getByText('Source 3')).toBeInTheDocument();
  });

  it('numbers untitled entries in display order, with no gap for a redacted one', () => {
    const untitled = (trigger: string): Source => kb(0, { metadata: { trigger } });
    const restricted: Source = { type: 'knowledge_base', content: '', confidence: null, metadata: { access: 'restricted' } };
    // Server order: case, restricted, kb_qa. Display order: kb_qa, case, restricted.
    render(<InlineSourcesRenderer content="Done." sources={[untitled('symptom'), restricted, untitled('kb_qa')]} />);

    expect(within(sectionOf("From the assistant's knowledge-base search")).getByText('Source 1')).toBeInTheDocument();
    expect(within(sectionOf('Matched to this case')).getByText('Source 2')).toBeInTheDocument();
    expect(screen.queryByText('Source 3')).toBeNull();
  });

  // The server strips a redacted entry's trigger with the rest of its metadata.
  // A core older than 16.2.0 sends no runbook number, so each entry is its own.
  it('lists a runbook the viewer may not open in a group of its own, once per entry from an older core', () => {
    const restricted: Source = {
      type: 'knowledge_base',
      content: '',
      confidence: null,
      metadata: { access: 'restricted' },
    };
    render(<InlineSourcesRenderer content="Done." sources={[withTrigger(1, 'question'), restricted, restricted]} />);

    const group = sectionOf("Runbooks you don't have access to");
    expect(within(group).getAllByText("A runbook you don't have access to")).toHaveLength(2);
    expect(screen.getByText('📚 3 runbooks in context')).toBeInTheDocument();
  });
});

// Contract 13.1.0 (fm#1920): a runbook this viewer may not open comes back
// redacted — no title, no document id, no excerpt, no score. A case retrieves
// with its DRIVER's knowledge (ADR-020 D9), so a reader meets these.
describe('InlineSourcesRenderer — a runbook the viewer may not open', () => {
  const restricted = (over: Partial<Source> = {}): Source => ({
    type: 'knowledge_base',
    content: '',
    confidence: null,
    metadata: { access: 'restricted' },
    new_this_turn: true,
    ...over,
  });

  it('says so, with no "Source N", no link and no preview', () => {
    render(
      <InlineSourcesRenderer content="Done." sources={[kb(1), restricted()]} onDocumentView={vi.fn()} />
    );

    expect(screen.getByText("A runbook you don't have access to")).toBeInTheDocument();
    expect(screen.queryByText('Source 2')).toBeNull();
    // The one link is the openable runbook's.
    expect(screen.getAllByRole('button', { name: /Open runbook/ })).toHaveLength(1);
    expect(screen.queryByText(/relevance/, { selector: 'span' })).toHaveTextContent('82% relevance');
    // Still a runbook the model had: the count stays true.
    expect(screen.getByText('📚 2 runbooks in context')).toBeInTheDocument();
  });

  it('is never a link, whatever stray metadata it carries', () => {
    const onDocumentView = vi.fn();
    render(
      <InlineSourcesRenderer
        content="Done."
        sources={[restricted({ metadata: { access: 'restricted', document_id: 'doc-9', title: 'Leaked' } })]}
        onDocumentView={onDocumentView}
      />
    );

    expect(screen.getByText("A runbook you don't have access to")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open runbook/ })).toBeNull();
    expect(screen.queryByText('Leaked')).toBeNull();
    expect(screen.queryByText(/Knowledge Base/)).toBeNull();
  });
});

// Contract 16.2.0 (fm#2824): redacted entries sharing `metadata.runbook` are
// sections of one hidden runbook, counted and listed once.
describe('InlineSourcesRenderer — hidden runbooks counted by their runbook number', () => {
  const restricted = (runbook?: unknown, extra: Record<string, unknown> = {}): Source => ({
    type: 'knowledge_base',
    content: '',
    confidence: null,
    metadata: runbook === undefined ? { access: 'restricted', ...extra } : { access: 'restricted', runbook, ...extra },
  });
  const header = (count: number): string => `📚 ${count === 1 ? '1 runbook' : `${count} runbooks`} in context`;
  const restrictedLines = (): number => screen.queryAllByText("A runbook you don't have access to").length;

  it.each<[string, Source[], number]>([
    ['two sections of one hidden runbook', [restricted(1), restricted(1)], 1],
    ['two hidden runbooks', [restricted(1), restricted(2), restricted(1)], 2],
    ['two entries from an older core, no number', [restricted(), restricted()], 2],
    ['numbered and unnumbered entries mixed', [restricted(1), restricted(), restricted(1), restricted()], 3],
  ])('%s', (_name, sources, hidden) => {
    render(<InlineSourcesRenderer content="Done." sources={sources} />);

    expect(screen.getByText(header(hidden))).toBeInTheDocument();
    // The restricted lines are exactly the hidden share of the header's count.
    expect(restrictedLines()).toBe(hidden);
  });

  it('counts a visible runbook and a hidden one as two', () => {
    render(<InlineSourcesRenderer content="Done." sources={[kb(1), restricted(1), kb(1), restricted(1)]} />);

    expect(screen.getByText(header(2))).toBeInTheDocument();
    expect(restrictedLines()).toBe(1);
  });

  it('keeps a hidden runbook apart from the visible runbook whose sections surround it', () => {
    render(<InlineSourcesRenderer content="Done." sources={[kb(1), restricted(1), kb(1)]} />);

    expect(screen.getByText(header(2))).toBeInTheDocument();
    expect(screen.getAllByText('Runbook 1')).toHaveLength(2);
    expect(restrictedLines()).toBe(1);
  });

  it.each([0, -1, 1.5, '1', null])('counts one per entry when the number is not an integer of at least 1 (%s)', (n) => {
    render(<InlineSourcesRenderer content="Done." sources={[restricted(n), restricted(n)]} />);

    expect(screen.getByText(header(2))).toBeInTheDocument();
    expect(restrictedLines()).toBe(2);
  });

  it('never groups hidden entries by a stray document id', () => {
    const stray = { document_id: 'doc-1' };
    render(
      <InlineSourcesRenderer
        content="Done."
        sources={[kb(1), restricted(undefined, stray), restricted(undefined, stray), restricted(3, stray)]}
      />
    );

    // doc-1 visible, two unnumbered hidden entries, and runbook 3: four.
    expect(screen.getByText(header(4))).toBeInTheDocument();
    expect(restrictedLines()).toBe(3);
  });
});
