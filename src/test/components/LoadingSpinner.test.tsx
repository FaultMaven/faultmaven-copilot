import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import LoadingSpinner, { LoadingOverlay, LoadingButton } from '../../shared/ui/components/LoadingSpinner';

describe('LoadingSpinner', () => {
  it('renders with default props', () => {
    render(<LoadingSpinner />);
    
    const spinner = screen.getByRole('status');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveAttribute('aria-live', 'polite');
  });

  it('renders with custom text', () => {
    render(<LoadingSpinner text="Loading data..." />);
    
    expect(screen.getByText('Loading data...')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading data...')).toBeInTheDocument();
  });

  it('applies correct size classes', () => {
    const { rerender } = render(<LoadingSpinner size="sm" />);
    let svg = screen.getByRole('status').querySelector('svg');
    expect(svg).toHaveClass('w-4', 'h-4');

    rerender(<LoadingSpinner size="lg" />);
    svg = screen.getByRole('status').querySelector('svg');
    expect(svg).toHaveClass('w-8', 'h-8');
  });

  it('applies correct color classes', () => {
    const { rerender } = render(<LoadingSpinner color="primary" />);
    let svg = screen.getByRole('status').querySelector('svg');
    expect(svg).toHaveClass('text-fm-blue');

    rerender(<LoadingSpinner color="secondary" />);
    svg = screen.getByRole('status').querySelector('svg');
    expect(svg).toHaveClass('text-fm-dim');
  });
});

describe('LoadingOverlay', () => {
  it('renders overlay with default text', () => {
    render(<LoadingOverlay />);
    
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders overlay with custom text', () => {
    render(<LoadingOverlay text="Processing..." />);
    
    expect(screen.getByText('Processing...')).toBeInTheDocument();
  });
});

describe('LoadingButton', () => {
  it('renders button without loading state', () => {
    render(<LoadingButton>Click me</LoadingButton>);
    
    expect(screen.getByText('Click me')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders button with loading state', () => {
    render(<LoadingButton loading>Click me</LoadingButton>);
    
    expect(screen.getByText('Click me')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('disables button when loading', () => {
    render(<LoadingButton loading>Click me</LoadingButton>);
    
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });

  it('disables button when disabled prop is true', () => {
    render(<LoadingButton disabled>Click me</LoadingButton>);
    
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });
});
