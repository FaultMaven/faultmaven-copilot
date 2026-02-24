/**
 * Local Login Form — ADR 003 Dark Theme
 *
 * Username/password login form for AUTH_MODE=local deployments.
 * Displayed directly in the extension (no redirect to Dashboard).
 */

import React, { useState } from 'react';
import { LocalAuthClient, type LocalLoginCredentials } from '../../../lib/auth/local-auth-client';
import type { AuthConfig } from '../../../lib/auth/auth-config';
import { createLogger } from '../../../lib/utils/logger';

const log = createLogger('LocalLoginForm');

interface LocalLoginFormProps {
  authConfig: AuthConfig;
  onAuthSuccess: () => void;
}

export function LocalLoginForm({ authConfig, onAuthSuccess }: LocalLoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  const authClient = new LocalAuthClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    if (!username.trim()) {
      setError('Username is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const credentials: LocalLoginCredentials = {
        username: username.trim(),
        password: password || undefined
      };

      log.info('Attempting local login', { username: credentials.username });

      const result = await authClient.signIn(credentials);

      if (result.success) {
        log.info('Login successful');
        onAuthSuccess();
      } else {
        log.warn('Login failed', { error: result.error });
        setError(result.error || 'Login failed');
        setIsLoading(false);
      }
    } catch (err: any) {
      log.error('Login error:', err);
      setError(err.message || 'An unexpected error occurred');
      setIsLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();

    if (!username.trim()) {
      setError('Username is required');
      return;
    }

    if (!email.trim()) {
      setError('Email is required');
      return;
    }

    if (!displayName.trim()) {
      setError('Display name is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      log.info('Attempting registration', { username });

      const result = await authClient.register({
        username: username.trim(),
        email: email.trim(),
        display_name: displayName.trim(),
        password: password || undefined
      });

      if (result.success) {
        log.info('Registration successful');
        onAuthSuccess();
      } else {
        log.warn('Registration failed', { error: result.error });
        setError(result.error || 'Registration failed');
        setIsLoading(false);
      }
    } catch (err: any) {
      log.error('Registration error:', err);
      setError(err.message || 'An unexpected error occurred');
      setIsLoading(false);
    }
  }

  const inputClasses = "w-full px-4 py-2 bg-fm-bg border border-fm-border rounded-lg text-fm-text placeholder-fm-muted focus:ring-2 focus:ring-fm-blue focus:border-fm-blue disabled:bg-fm-elevated disabled:cursor-not-allowed";

  return (
    <div className="w-full max-w-md">
      {!showRegister ? (
        /* Login Form */
        <form onSubmit={handleLogin} className="space-y-4">
          {/* Username Field */}
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-fm-text mb-1">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
              className={inputClasses}
              placeholder="Enter your username"
              autoComplete="username"
              autoFocus
            />
          </div>

          {/* Password Field (Optional) */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-fm-text mb-1">
              Password <span className="text-fm-muted text-xs">(optional)</span>
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              className={inputClasses}
              placeholder="Enter your password (if set)"
              autoComplete="current-password"
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-fm-red-light border border-fm-red-border rounded-lg">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-fm-red flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-fm-red">{error}</p>
              </div>
            </div>
          )}

          {/* Sign In Button */}
          <button
            type="submit"
            disabled={isLoading || !username.trim()}
            className="w-full px-6 py-3 bg-fm-blue text-white font-medium rounded-lg hover:bg-fm-active transition-colors disabled:bg-fm-elevated disabled:text-fm-muted disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                <span>Sign In</span>
              </>
            )}
          </button>

          {/* Registration Link */}
          {authConfig.features.supports_registration && (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setShowRegister(true)}
                disabled={isLoading}
                className="text-sm text-fm-blue hover:text-fm-active hover:underline disabled:text-fm-muted disabled:cursor-not-allowed"
              >
                Don't have an account? Register
              </button>
            </div>
          )}
        </form>
      ) : (
        /* Registration Form */
        <form onSubmit={handleRegister} className="space-y-4">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-white">Create Account</h3>
            <p className="text-sm text-fm-dim">Register for a new FaultMaven account</p>
          </div>

          {/* Username Field */}
          <div>
            <label htmlFor="reg-username" className="block text-sm font-medium text-fm-text mb-1">
              Username <span className="text-fm-red">*</span>
            </label>
            <input
              id="reg-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
              className={inputClasses}
              placeholder="Choose a username"
              autoComplete="username"
              autoFocus
            />
          </div>

          {/* Email Field */}
          <div>
            <label htmlFor="reg-email" className="block text-sm font-medium text-fm-text mb-1">
              Email <span className="text-fm-red">*</span>
            </label>
            <input
              id="reg-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              className={inputClasses}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </div>

          {/* Display Name Field */}
          <div>
            <label htmlFor="reg-display-name" className="block text-sm font-medium text-fm-text mb-1">
              Display Name <span className="text-fm-red">*</span>
            </label>
            <input
              id="reg-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={isLoading}
              className={inputClasses}
              placeholder="Your full name"
              autoComplete="name"
            />
          </div>

          {/* Password Field (Optional) */}
          <div>
            <label htmlFor="reg-password" className="block text-sm font-medium text-fm-text mb-1">
              Password <span className="text-fm-muted text-xs">(optional)</span>
            </label>
            <input
              id="reg-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              className={inputClasses}
              placeholder="Set a password (if desired)"
              autoComplete="new-password"
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-fm-red-light border border-fm-red-border rounded-lg">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-fm-red flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-fm-red">{error}</p>
              </div>
            </div>
          )}

          {/* Register Button */}
          <button
            type="submit"
            disabled={isLoading || !username.trim() || !email.trim() || !displayName.trim()}
            className="w-full px-6 py-3 bg-fm-blue text-white font-medium rounded-lg hover:bg-fm-active transition-colors disabled:bg-fm-elevated disabled:text-fm-muted disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Creating account...</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
                <span>Create Account</span>
              </>
            )}
          </button>

          {/* Back to Login Link */}
          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => {
                setShowRegister(false);
                setError(null);
              }}
              disabled={isLoading}
              className="text-sm text-fm-blue hover:text-fm-active hover:underline disabled:text-fm-muted disabled:cursor-not-allowed"
            >
              Already have an account? Sign in
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
