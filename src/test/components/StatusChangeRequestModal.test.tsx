import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { StatusChangeRequestModal } from '@faultmaven/copilot-ui/shared/ui/components/case-header/StatusChangeRequestModal';
import { getCaseActionMessage } from '@faultmaven/copilot-ui/lib/api/services/case-service';

function renderModal(currentStatus: string, newStatus: string) {
  render(
    <StatusChangeRequestModal
      isOpen
      currentStatus={currentStatus}
      newStatus={newStatus}
      onConfirm={() => {}}
      onCancel={() => {}}
    />,
  );
  return screen.getByRole('dialog');
}

// The modal previews the request under "Your request will be sent to the
// agent:". It must quote exactly what `ChatWindow` sends — the one table in
// case-service — for every pair the menu offers.
describe('StatusChangeRequestModal — previews the text the copilot sends', () => {
  it.each([
    ['inquiry', 'closed'],
    ['investigating', 'closed'],
  ])('%s → %s quotes getCaseActionMessage', (from, to) => {
    const sent = getCaseActionMessage(from, to);
    expect(sent).toBeTruthy();
    renderModal(from, to);
    expect(screen.getByText(`"${sent}"`)).toBeInTheDocument();
  });

  // #2441: on a declined resolution the server closes an investigating case as
  // `resolution_declined`. Copy that promises "unresolved" contradicts that, so
  // the title, preview and terminal warning say nothing about how it closes.
  it('investigating → closed never says how the case will close', () => {
    const dialog = renderModal('investigating', 'closed');
    // The title follows a decorative icon span; nothing else may surround it.
    expect(screen.getByRole('heading')).toHaveTextContent(/^\W*Close this case\?$/u);
    expect(dialog.textContent).toContain('terminal disposition');
    expect(dialog.textContent?.toLowerCase()).not.toContain('unresolved');
  });
});
