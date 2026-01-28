import { getApiUrl } from "../../config";
import config from "../../config";
import { browser } from 'wxt/browser';
import { createLogger } from '../utils/logger';
import { getAuthHeaders } from '../api/fetch-utils';

const log = createLogger('ClientSessionManager');

// Enhanced TypeScript interfaces for client-based session management
export interface SessionCreateRequest {
  timeout_minutes?: number; // 1 min to 24 hours (default: 30)
  session_type?: string; // default: "troubleshooting"
  metadata?: Record<string, any>;
  client_id?: string; // NEW - Client/device identifier for session resumption
}

export interface SessionCreateResponse {
  session_id: string;
  user_id: string;                   // NOW REQUIRED (v2.0)
  client_id?: string;                // Device identifier for session resumption
  status: string;                    // "active"
  created_at: string;                // UTC ISO 8601 format
  session_type: string;
  session_resumed?: boolean;         // true if existing session was resumed
  expires_at?: string;               // Session expiration timestamp (TTL) - v2.0
  message: string;                   // "Session created successfully" or "Session resumed successfully"
  last_activity?: string;
  metadata?: Record<string, any>;
}

/**
 * Manages client-based session persistence and resumption
 *
 * Features:
 * - Seamless session continuity across browser restarts
 * - Session timeout + resume strategy for crash recovery (3 hours default)
 * - Automatic session expiration handling
 * - Invisible to users - no manual session management required
 *
 * Behavior:
 * - Browser restart < 3 hours: Resume previous session seamlessly
 * - Browser restart > 3 hours: Create fresh session automatically
 * - Session corruption/expiration: Auto-recover with new session
 */
export class ClientSessionManager {
  private static CLIENT_ID_KEY = 'faultmaven_client_id';
  private static instance: ClientSessionManager;
  private clientId: string | null = null;

  // Session timeout configuration (in minutes)
  private static readonly DEFAULT_SESSION_TIMEOUT = config.session.timeoutMinutes;
  private static readonly MIN_SESSION_TIMEOUT = 60;      // 1 hour minimum
  private static readonly MAX_SESSION_TIMEOUT = 480;     // 8 hours maximum

  /**
   * Get singleton instance of ClientSessionManager
   */
  static getInstance(): ClientSessionManager {
    if (!this.instance) {
      this.instance = new ClientSessionManager();
    }
    return this.instance;
  }

  /**
   * Get or generate a unique client ID for this browser instance
   * Client ID persists across browser sessions via browser.storage.local
   */
  async getOrCreateClientId(): Promise<string> {
    if (!this.clientId) {
      // Try to get from storage first
      if (typeof browser !== 'undefined' && browser.storage) {
        const stored = await browser.storage.local.get([ClientSessionManager.CLIENT_ID_KEY]);
        this.clientId = stored[ClientSessionManager.CLIENT_ID_KEY];
      } else {
        // Fallback for non-extension environments (e.g., unit tests)
        this.clientId = localStorage.getItem(ClientSessionManager.CLIENT_ID_KEY);
      }

      if (!this.clientId) {
        // Generate UUID v4 using crypto.randomUUID() for performance
        this.clientId = crypto.randomUUID();
        
        if (typeof browser !== 'undefined' && browser.storage) {
          await browser.storage.local.set({ [ClientSessionManager.CLIENT_ID_KEY]: this.clientId });
        } else {
          localStorage.setItem(ClientSessionManager.CLIENT_ID_KEY, this.clientId);
        }
        
        log.info('Generated new client ID:', this.clientId.slice(0, 8) + '...');
      } else {
        log.info('Using existing client ID:', this.clientId.slice(0, 8) + '...');
      }
    }

    return this.clientId;
  }

  /**
   * Create a new session or resume existing session based on client_id
   * Implements timeout + resume strategy for crash recovery
   */
  async createSession(userContext?: any, timeoutMinutes?: number): Promise<SessionCreateResponse> {
    const clientId = await this.getOrCreateClientId();
    const apiUrl = await getApiUrl();

    // Use provided timeout or default, enforcing min/max limits
    const sessionTimeout = this.validateSessionTimeout(timeoutMinutes || ClientSessionManager.DEFAULT_SESSION_TIMEOUT);

    const requestBody: SessionCreateRequest = {
      client_id: clientId,
      session_type: 'troubleshooting',
      timeout_minutes: sessionTimeout
    };

    // Add user context metadata if provided
    if (userContext) {
      requestBody.metadata = userContext;
    }

    log.info('Creating session with client_id:', clientId.slice(0, 8) + '...');

    // Include auth headers so backend can associate session with authenticated user
    const authHeaders = await getAuthHeaders();

    // Debug: Log if Authorization header is present (use warn to ensure visibility in prod builds)
    const hasAuth = 'Authorization' in authHeaders;
    log.warn('Session creation auth check:', { hasAuthorization: hasAuth });

    const response = await fetch(`${apiUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: {
        ...authHeaders,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Failed to create session: ${response.status}`);
    }

    const sessionResponse: SessionCreateResponse = await response.json();

    // Log session creation/resumption
    if (sessionResponse.session_resumed) {
      log.info('Session resumed:', sessionResponse.session_id);
    } else {
      log.info('New session created:', sessionResponse.session_id);
    }

    return sessionResponse;
  }

  /**
   * Check if a session response indicates a resumed session
   */
  isSessionResumed(response: SessionCreateResponse): boolean {
    return response.session_resumed === true;
  }

  /**
   * Clear client ID to force creation of new session
   * Note: This is primarily used internally for session expiration recovery.
   * UI no longer exposes manual session forcing to users.
   */
  async clearClientId(): Promise<void> {
    this.clientId = null;
    
    if (typeof browser !== 'undefined' && browser.storage) {
      await browser.storage.local.remove([ClientSessionManager.CLIENT_ID_KEY]);
    } else {
      localStorage.removeItem(ClientSessionManager.CLIENT_ID_KEY);
    }
    
    log.info('Client ID cleared - next session will be new');
  }

  /**
   * Get current client ID without generating new one
   * Returns null if no client ID exists
   */
  async getCurrentClientId(): Promise<string | null> {
    if (this.clientId) return this.clientId;
    
    if (typeof browser !== 'undefined' && browser.storage) {
      const stored = await browser.storage.local.get([ClientSessionManager.CLIENT_ID_KEY]);
      return stored[ClientSessionManager.CLIENT_ID_KEY] || null;
    }
    
    return localStorage.getItem(ClientSessionManager.CLIENT_ID_KEY);
  }

  /**
   * Validate and clamp session timeout to acceptable range
   */
  private validateSessionTimeout(timeoutMinutes: number): number {
    return Math.max(
      ClientSessionManager.MIN_SESSION_TIMEOUT,
      Math.min(ClientSessionManager.MAX_SESSION_TIMEOUT, timeoutMinutes)
    );
  }

  /**
   * Handle session creation with automatic error recovery
   * Implements timeout + resume strategy for crash recovery
   */
  async createSessionWithRecovery(userContext?: any, timeoutMinutes?: number): Promise<SessionCreateResponse> {
    try {
      const response = await this.createSession(userContext, timeoutMinutes);

      // Log session creation/resumption with timeout info
      const timeoutUsed = this.validateSessionTimeout(timeoutMinutes || ClientSessionManager.DEFAULT_SESSION_TIMEOUT);
      if (response.session_resumed) {
        log.info(`Session resumed successfully, timeout: ${timeoutUsed} minutes`);
      } else {
        log.info(`New session created, timeout: ${timeoutUsed} minutes`);
      }

      return response;
    } catch (error: any) {
      // Handle expired/invalid session scenarios (404, 410, session not found)
      if (this.isSessionExpiredError(error)) {
        log.warn('Session expired/invalid after browser crash - creating fresh session');
        await this.clearClientId();
        return await this.createSession(userContext, timeoutMinutes);
      }
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Check if error indicates an expired/invalid session
   */
  private isSessionExpiredError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';
    return (
      message.includes('404') ||
      message.includes('410') ||
      message.includes('session not found') ||
      message.includes('session expired') ||
      message.includes('invalid session')
    );
  }
}

// Export singleton instance for convenience
export const clientSessionManager = ClientSessionManager.getInstance();
