/**
 * Auth Client Factory
 *
 * Implements deployment-agnostic authentication strategy pattern.
 * Selects appropriate auth client (Local vs OAuth) based on backend configuration.
 *
 * Usage:
 *   const authClient = await AuthClientFactory.create();
 *   await authClient.signIn(credentials);
 */

import { createLogger } from '../utils/logger';
import { getAuthConfig, type AuthConfig } from './auth-config';
import { LocalAuthClient, type AuthResult, type LocalLoginCredentials } from './local-auth-client';
import { OAuthClient } from './oauth-client';

const log = createLogger('AuthClientFactory');

/**
 * Unified authentication client interface
 *
 * Both LocalAuthClient and OAuthClient implement this interface
 * for deployment-agnostic authentication.
 */
export interface IAuthClient {
  /**
   * Sign in with credentials (local) or initiate OAuth flow (cloud)
   *
   * @param credentials - Optional credentials for local mode
   * @returns Authentication result
   */
  signIn(credentials?: LocalLoginCredentials): Promise<AuthResult>;

  /**
   * Sign out and clear authentication state
   */
  signOut(): Promise<void>;

  /**
   * Get current access token
   *
   * @returns Access token or null if not authenticated
   */
  getAccessToken(): Promise<string | null>;
}

/**
 * Auth Client Factory
 *
 * Creates the appropriate auth client based on backend configuration.
 */
export class AuthClientFactory {
  /**
   * Create auth client based on backend auth_mode
   *
   * Queries GET /api/v1/auth/config to determine auth mode:
   * - 'local' → LocalAuthClient (direct username/password)
   * - 'oidc' or 'saml' → OAuthClient (Dashboard-centric OAuth)
   *
   * @returns Configured auth client
   */
  static async create(): Promise<IAuthClient> {
    try {
      log.info('Creating auth client...');

      // Query backend for auth configuration
      const config = await getAuthConfig();

      log.info('Auth configuration retrieved', {
        provider: config.provider,
        requires_redirect: config.features.requires_redirect
      });

      // Select client based on auth mode
      if (config.provider === 'local') {
        log.info('Using LocalAuthClient for local mode');
        return new LocalAuthClient();
      } else if (config.provider === 'oidc' || config.provider === 'saml') {
        log.info('Using OAuthClient for OAuth/SSO mode');
        return new OAuthClient(config);
      } else {
        log.warn('Unknown auth provider, defaulting to LocalAuthClient', {
          provider: config.provider
        });
        return new LocalAuthClient();
      }

    } catch (error) {
      log.error('Failed to create auth client, defaulting to LocalAuthClient', error);

      // Fallback to local client if config fetch fails
      return new LocalAuthClient();
    }
  }

  /**
   * Get current auth mode without creating a client
   *
   * @returns Auth configuration
   */
  static async getAuthMode(): Promise<AuthConfig> {
    return getAuthConfig();
  }
}

// Re-export types for convenience
export type { LocalLoginCredentials, AuthResult } from './local-auth-client';
export type { AuthConfig } from './auth-config';
