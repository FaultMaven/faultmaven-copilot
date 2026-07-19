import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { WelcomeScreen } from '~/shared/ui/components/WelcomeScreen';
import { ErrorModal } from '~/shared/ui/components/ErrorModal';
import DocumentDetailsModal from '~/shared/ui/components/DocumentDetailsModal';
import { StatusChangeRequestModal } from '~/shared/ui/components/case-header/StatusChangeRequestModal';

// Mock browser extension API
vi.mock('wxt/browser', () => ({
  browser: {
    storage: { local: { set: vi.fn() } },
    permissions: { request: vi.fn() },
    runtime: { openOptionsPage: vi.fn() }
  }
}));

describe('Accessibility: WelcomeScreen', () => {
  it('should have proper ARIA attributes', () => {
    render(<WelcomeScreen onComplete={() => {}} />);
    
    // Check main role
    const mainRegion = screen.getByRole('main', { name: 'Welcome Setup' });
    expect(mainRegion).toBeInTheDocument();
    
    // Check headings
    expect(screen.getByRole('heading', { level: 1, name: /Welcome to FaultMaven Copilot/i })).toBeInTheDocument();
    
    // Check buttons have accessible names (aria-labelledby)
    const cloudBtn = screen.getByRole('button', { name: /FaultMaven Cloud \(SaaS\)/i });
    expect(cloudBtn).toHaveAttribute('aria-describedby', 'cloud-desc');
    
    const standaloneBtn = screen.getByRole('button', { name: /FaultMaven Standalone \(Self-Hosted\)/i });
    expect(standaloneBtn).toHaveAttribute('aria-describedby', 'standalone-desc');
  });
});

const mockActiveError = {
  id: 'err-123',
  error: {
    userTitle: 'Test Error Title',
    userMessage: 'This is a test error message.',
    userAction: 'Please try again.'
  },
  displayOptions: {
    dismissible: true,
    blocking: false,
    icon: 'error' as const,
    actions: [
      { label: 'Retry', primary: true, onClick: vi.fn() },
      { label: 'Cancel', primary: false }
    ]
  }
};

describe('Accessibility: ErrorModal', () => {
  it('should trap focus and restore focus on dismiss', async () => {
    const user = userEvent.setup();
    const onActionMock = vi.fn();
    
    const TestWrapper = () => {
      const [activeError, setActiveError] = React.useState<any>(null);
      return (
        <div>
          <button 
            data-testid="trigger-btn" 
            onClick={() => setActiveError(mockActiveError)}
          >
            Trigger Error
          </button>
          <ErrorModal activeError={activeError} onAction={(id) => {
            onActionMock(id);
            setActiveError(null);
          }} />
        </div>
      );
    };

    render(<TestWrapper />);
    const triggerBtn = screen.getByTestId('trigger-btn');
    
    // 1. Initial focus on trigger button
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);

    // 2. Open the modal
    await user.click(triggerBtn);
    
    // 3. Modal is open, inner wrapper gets focused programmatically
    const modalContent = screen.getByRole('dialog').querySelector('[tabindex="-1"]');
    expect(document.activeElement).toBe(modalContent);

    // 4. Tab sequence
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    const cancelBtns = screen.getAllByRole('button', { name: 'Cancel' });
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    
    await user.tab();
    expect(document.activeElement).toBe(retryBtn);

    await user.tab();
    expect(document.activeElement).toBe(cancelBtns[0]);

    await user.tab();
    expect(document.activeElement).toBe(cancelBtns[1]);

    await user.tab();
    expect(document.activeElement).toBe(closeBtn);

    // 5. Wrap around
    await user.tab();
    expect(document.activeElement).toBe(retryBtn);

    // 6. Press ESC to dismiss
    await user.keyboard('{Escape}');
    
    // 7. Verify close and focus restoration
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(triggerBtn);
    expect(onActionMock).toHaveBeenCalledWith('err-123');
  });
});

const mockDocument = {
  document_id: 'doc-123',
  title: 'Test Document',
  document_type: 'help_article' as any,
  category: 'Troubleshooting',
  description: 'This is a test description',
  tags: ['test', 'help'],
  content: 'This is the content of the test document',
  created_at: '2026-06-25T08:00:00Z',
  updated_at: '2026-06-25T08:00:00Z'
};

describe('Accessibility: DocumentDetailsModal', () => {
  it('should trap focus and restore focus on close', async () => {
    const user = userEvent.setup();
    const onCloseMock = vi.fn();
    
    const TestWrapper = () => {
      const [isOpen, setIsOpen] = React.useState(false);
      return (
        <div>
          <button 
            data-testid="trigger-btn" 
            onClick={() => setIsOpen(true)}
          >
            View Document
          </button>
          <DocumentDetailsModal 
            document={mockDocument} 
            isOpen={isOpen} 
            onClose={() => {
              onCloseMock();
              setIsOpen(false);
            }} 
            onEdit={() => {}} 
          />
        </div>
      );
    };

    render(<TestWrapper />);
    const triggerBtn = screen.getByTestId('trigger-btn');
    
    // 1. Initial focus
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);

    // 2. Open modal
    await user.click(triggerBtn);
    
    // 3. Modal container itself gets focused
    const modalContainer = screen.getByRole('dialog');
    expect(document.activeElement).toBe(modalContainer);

    // 4. Tab sequence
    const editBtn = screen.getByRole('button', { name: 'Edit' });
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    const closeHeaderBtn = closeButtons[0];
    const closeFooterBtn = closeButtons[1];
    
    await user.tab();
    expect(document.activeElement).toBe(editBtn);

    await user.tab();
    expect(document.activeElement).toBe(closeHeaderBtn);

    await user.tab();
    expect(document.activeElement).toBe(closeFooterBtn);

    // Wrap around
    await user.tab();
    expect(document.activeElement).toBe(editBtn);

    // 5. Escape key closure
    await user.keyboard('{Escape}');
    
    // 6. Focus restored
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(triggerBtn);
    expect(onCloseMock).toHaveBeenCalled();
  });
});

describe('Accessibility: StatusChangeRequestModal', () => {
  it('should trap focus and restore focus on cancel', async () => {
    const user = userEvent.setup();
    const onCancelMock = vi.fn();

    const TestWrapper = () => {
      const [isOpen, setIsOpen] = React.useState(false);
      return (
        <div>
          <button
            data-testid="trigger-btn"
            onClick={() => setIsOpen(true)}
          >
            Change Status
          </button>
          <StatusChangeRequestModal
            isOpen={isOpen}
            currentStatus="inquiry"
            newStatus="investigating"
            onConfirm={() => {}}
            onCancel={() => {
              onCancelMock();
              setIsOpen(false);
            }}
          />
        </div>
      );
    };

    render(<TestWrapper />);
    const triggerBtn = screen.getByTestId('trigger-btn');

    // 1. Initial focus on trigger button
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);

    // 2. Open modal
    await user.click(triggerBtn);

    // 3. Modal container itself gets focused, with dialog semantics
    const modalContainer = screen.getByRole('dialog');
    expect(document.activeElement).toBe(modalContainer);
    expect(modalContainer).toHaveAttribute('aria-modal', 'true');
    expect(modalContainer).toHaveAttribute('aria-labelledby', 'status-change-modal-title');

    // 4. Tab sequence cycles within the modal
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    const continueBtn = screen.getByRole('button', { name: 'Continue' });

    await user.tab();
    expect(document.activeElement).toBe(cancelBtn);

    await user.tab();
    expect(document.activeElement).toBe(continueBtn);

    // Wrap around
    await user.tab();
    expect(document.activeElement).toBe(cancelBtn);

    // 5. Escape key closure
    await user.keyboard('{Escape}');

    // 6. Focus restored to trigger
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(triggerBtn);
    expect(onCancelMock).toHaveBeenCalled();
  });
});
