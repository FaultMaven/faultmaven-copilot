import React, { forwardRef } from 'react';

// Accessible Button Component
interface AccessibleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
  iconOnly?: boolean;
  tooltip?: string;
}

export const AccessibleButton = forwardRef<HTMLButtonElement, AccessibleButtonProps>(
  ({ 
    children, 
    variant = 'primary', 
    size = 'md', 
    loading = false,
    icon,
    iconOnly = false,
    tooltip,
    className = '',
    disabled,
    ...props 
  }, ref) => {
    const baseClasses = 'relative group inline-flex items-center justify-center font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';
    
    const variantClasses = {
      primary: 'bg-fm-accent text-white hover:opacity-90 focus:ring-fm-accent disabled:bg-fm-elevated',
      secondary: 'bg-fm-elevated text-white hover:bg-fm-elevated focus:ring-fm-accent disabled:bg-fm-surface',
      danger: 'bg-fm-critical text-white hover:opacity-90 focus:ring-fm-critical disabled:bg-fm-elevated',
      ghost: 'bg-transparent text-fm-text-primary hover:bg-fm-surface focus:ring-fm-accent disabled:text-fm-text-tertiary'
    } as const;

    const sizeClasses = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base'
    } as const;

    const content = (
      <>
        {loading && (
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {icon && !loading && (
          <span className={`${iconOnly || !children ? '' : 'mr-2'}`}>{icon}</span>
        )}
        {/* If iconOnly, keep accessible name via children in sr-only when provided */}
        {iconOnly ? (
          <span className="sr-only">{typeof props['aria-label'] === 'string' ? props['aria-label'] : children}</span>
        ) : (
          children
        )}
        {tooltip && (
          <span className="pointer-events-none absolute right-0 top-[calc(100%+6px)] whitespace-nowrap rounded-md bg-fm-elevated/95 px-2 py-0.5 text-[10px] text-white opacity-0 shadow-md z-50 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {tooltip}
          </span>
        )}
      </>
    );

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${iconOnly ? 'px-0' : ''} ${className}`}
        {...props}
      >
        {content}
      </button>
    );
  }
);

// Accessible Text Input
interface AccessibleInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
  required?: boolean;
}

export const AccessibleInput = forwardRef<HTMLInputElement, AccessibleInputProps>(
  ({ label, error, helperText, required = false, className = '', ...props }, ref) => {
    const id = props.id || `input-${Math.random().toString(36).substr(2, 9)}`;
    const errorId = `${id}-error`;
    const helperId = `${id}-helper`;

    return (
      <div className="space-y-1">
        <label htmlFor={id} className="block text-sm font-medium text-fm-text-primary">
          {label}
          {required && <span className="text-fm-critical ml-1">*</span>}
        </label>
        <input
          ref={ref}
          id={id}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          aria-invalid={error ? 'true' : 'false'}
          className={`
            block w-full px-3 py-2 border rounded-md shadow-sm
            focus:outline-none focus:ring-2 focus:ring-fm-accent focus:border-fm-accent
            disabled:bg-fm-bg disabled:text-fm-text-tertiary
            ${error ? 'border-fm-border' : 'border-fm-border'}
            ${className}
          `}
          {...props}
        />
        {error && (
          <p id={errorId} className="text-sm text-fm-critical" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={helperId} className="text-sm text-fm-text-tertiary">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

// Accessible Textarea
interface AccessibleTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  helperText?: string;
  required?: boolean;
}

export const AccessibleTextarea = forwardRef<HTMLTextAreaElement, AccessibleTextareaProps>(
  ({ label, error, helperText, required = false, className = '', ...props }, ref) => {
    const id = props.id || `textarea-${Math.random().toString(36).substr(2, 9)}`;
    const errorId = `${id}-error`;
    const helperId = `${id}-helper`;

    return (
      <div className="space-y-1">
        <label htmlFor={id} className="block text-sm font-medium text-fm-text-primary">
          {label}
          {required && <span className="text-fm-critical ml-1">*</span>}
        </label>
        <textarea
          ref={ref}
          id={id}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          aria-invalid={error ? 'true' : 'false'}
          className={`
            block w-full px-3 py-2 border rounded-md shadow-sm resize-none
            focus:outline-none focus:ring-2 focus:ring-fm-accent focus:border-fm-accent
            disabled:bg-fm-bg disabled:text-fm-text-tertiary
            ${error ? 'border-fm-border' : 'border-fm-border'}
            ${className}
          `}
          {...props}
        />
        {error && (
          <p id={errorId} className="text-sm text-fm-critical" role="alert">
            {error}
          </p>
        )}
        {helperText && !error && (
          <p id={helperId} className="text-sm text-fm-text-tertiary">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

// Accessible Modal/Dialog
interface AccessibleModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function AccessibleModal({ isOpen, onClose, title, children, size = 'md' }: AccessibleModalProps) {
  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl'
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className={`relative bg-fm-surface rounded-lg shadow-xl ${sizeClasses[size]} w-full`}>
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <h2 id="modal-title" className="text-lg font-medium text-white">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="text-fm-text-secondary hover:text-fm-text-primary focus:outline-none focus:text-fm-text-primary"
              aria-label="Close modal"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Content */}
          <div className="p-4">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
