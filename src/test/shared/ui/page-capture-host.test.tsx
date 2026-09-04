/**
 * Page capture in a host that cannot do it, asserted through the rendered UI.
 *
 * The requirement is not "degrade gracefully". It is that the affordance stays
 * VISIBLE and ENABLED, and that pressing it explains what is missing and offers
 * the way to get it. A hidden button teaches the user nothing; a disabled one
 * teaches them less than nothing, because it looks like a defect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { UnifiedInputBar } from '../../../shared/ui/components/UnifiedInputBar';
import {
  createStubHost,
  hostWrapper,
  STUB_CAPTURE_REASON,
  STUB_INSTALL_URL,
} from '../../support/host';

const captureButton = () => screen.getByRole('button', { name: /Analyze current page/i });

const renderBar = (stub: ReturnType<typeof createStubHost>) =>
  render(
    <UnifiedInputBar onQuerySubmit={vi.fn()} onTurnSubmit={vi.fn()} />,
    { wrapper: hostWrapper(stub.host) },
  );

describe('page capture — a host that cannot read the page', () => {
  let stub: ReturnType<typeof createStubHost>;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubHost({}, { pageCapture: false });
  });

  it('still renders the capture button, and leaves it enabled', () => {
    renderBar(stub);

    const button = captureButton();
    expect(button).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it('explains what is missing when the button is pressed', async () => {
    renderBar(stub);
    fireEvent.click(captureButton());

    await waitFor(() => expect(screen.getByText(STUB_CAPTURE_REASON)).toBeInTheDocument());
  });

  it('offers the store listing as a real outbound link', async () => {
    renderBar(stub);
    fireEvent.click(captureButton());

    const link = await screen.findByRole('link', { name: /Install the Copilot extension/i });
    expect(link).toHaveAttribute('href', STUB_INSTALL_URL);
    // Opened away from the panel, and without handing the opener a window
    // reference back into it.
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('announces the explanation as a status, not an alert', async () => {
    renderBar(stub);
    fireEvent.click(captureButton());

    // An explanation of a capability this host does not have is not an
    // emergency, and must not interrupt a screen reader as one.
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent(STUB_CAPTURE_REASON);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stages nothing — there is no capture to stage', async () => {
    renderBar(stub);
    fireEvent.click(captureButton());

    await screen.findByRole('status');
    // The staged-page chip is what a successful capture produces.
    expect(screen.queryByText(/📸 Captured:/)).toBeNull();
  });
});

describe('page capture — a host that can read the page', () => {
  let stub: ReturnType<typeof createStubHost>;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubHost();
  });

  it('asks the host to capture, and stages what it returns', async () => {
    stub.capture!.mockResolvedValue({
      content: 'panel text',
      url: 'https://grafana.example/d/abc',
    });

    renderBar(stub);
    fireEvent.click(captureButton());

    await waitFor(() => expect(stub.capture).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/grafana\.example/)).toBeInTheDocument();
    // Nothing to explain when the host can do it.
    expect(screen.queryByRole('link', { name: /Install/i })).toBeNull();
  });

  it("surfaces the host's own refusal, unchanged", async () => {
    // The extension's capture path throws sentences written for the user —
    // "Local files (file://) can't be captured", "browser internal pages" —
    // and those must reach the input bar rather than a generic failure.
    stub.capture!.mockRejectedValue(new Error('Page capture works on http:// and https:// pages only.'));

    renderBar(stub);
    fireEvent.click(captureButton());

    expect(
      await screen.findByText('Page capture works on http:// and https:// pages only.'),
    ).toBeInTheDocument();
  });
});
