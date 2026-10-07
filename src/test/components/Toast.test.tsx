import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import Toast from '@faultmaven/copilot-ui/shared/ui/components/Toast';
import type { ActiveError } from '@faultmaven/copilot-ui/lib/errors/useErrorHandler';
import { DuplicateUploadNotice, ServerError } from '@faultmaven/copilot-ui/lib/errors/types';
import type { UserFacingError } from '@faultmaven/copilot-ui/lib/errors/types';

function active(error: UserFacingError & { getDisplayOptions(): ActiveError['displayOptions'] }): ActiveError {
  return { id: 'e1', error, displayOptions: error.getDisplayOptions(), timestamp: 0, dismissed: false };
}

// A notice is not a failure: it is announced without interrupting what the
// user is doing, while a real error still interrupts.
describe('Toast — how it is announced', () => {
  // The toast reads the reduced-motion preference; the test DOM has no matchMedia.
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('announces an info notice politely', () => {
    render(<Toast activeError={active(new DuplicateUploadNotice([{ filename: 'app.log', origin: 'file_upload' }]))} onDismiss={vi.fn()} />);
    const toast = screen.getByRole('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('announces an error assertively', () => {
    render(<Toast activeError={active(new ServerError('boom'))} onDismiss={vi.fn()} />);
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive');
  });
});
