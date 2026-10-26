import { ownedStorage } from '../owned-storage';
import { getApiTransport } from '../api/transport';
import config from "../../config";
import { createLogger } from '../utils/logger';
import { getAuthHeaders } from '../api/fetch-utils';
import { fetchWithTimeout } from '../utils/fetch-timeout';
import { errorBodyText } from '../errors/error-body';
import { AuthenticationError, SessionExpiredError } from '../errors/types';
import { handleAuthError } from '../api/auth-verdict';

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
   * Client ID persists across browser sessions via host storage
   */
  async getOrCreateClientId(): Promise<string> {
    if (!this.clientId) {
      // Try to get from storage first
      // No non-extension fallback any more: answering storage in whatever
      // environment this runs in is exactly what the host store is for, and a
      // localStorage branch here was a second storage path by another name.
      const stored = (await ownedStorage.get([ClientSessionManager.CLIENT_ID_KEY])) as
        Record<string, string | undefined>;
      this.clientId = stored[ClientSessionManager.CLIENT_ID_KEY] ?? null;

      if (!this.clientId) {
        // Generate UUID v4 using crypto.randomUUID() for performance
        this.clientId = crypto.randomUUID();
        
        await ownedStorage.set({ [ClientSessionManager.CLIENT_ID_KEY]: this.clientId });
        
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
   *
   * Only ever for `expectedOwner`, and only with a bearer (faultmaven#1460):
   * with none it throws before sending, since the server would mint for
   * nobody. A 401, or a session minted for someone else (the server resolved
   * our bearer to nobody: revoked or invalid), is a rejected credential and
   * gets the host's verdict, as on every other route.
   */
  async createSession(
    expectedOwner: string,
    userContext?: any,
    timeoutMinutes?: number,
  ): Promise<SessionCreateResponse> {
    return this.mint(expectedOwner, true, userContext, timeoutMinutes);
  }

  /** `askHost`: whether a rejected credential may still get the host's verdict. */
  private async mint(
    expectedOwner: string,
    askHost: boolean,
    userContext?: any,
    timeoutMinutes?: number,
  ): Promise<SessionCreateResponse> {
    const clientId = await this.getOrCreateClientId();
    const apiUrl = await getApiTransport().baseUrl();

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

    const send = async () => {
      // Read per send: after a 'refreshed' verdict this is the renewed bearer.
      const authHeaders = (await getAuthHeaders()) as Record<string, string>;
      const bearer = (authHeaders['Authorization'] ?? '').replace(/^Bearer\s+/i, '');
      if (!bearer) throw new SessionExpiredError('No credential to mint a session with');
      const response = await fetchWithTimeout(`${apiUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { ...authHeaders },
        body: JSON.stringify(requestBody),
      });
      return { response, bearer };
    };

    let { response, bearer } = await send();
    let session = await this.ownedSession(response, expectedOwner);
    if (!session) {
      if (!askHost) throw new AuthenticationError('Authentication required');
      // Throws on 'ended', after its epoch bump, and on 'unavailable', as a
      // NetworkError with no bump: the session slice's ensure retries it.
      await handleAuthError(bearer);
      ({ response, bearer } = await send());
      session = await this.ownedSession(response, expectedOwner);
      // Rejected again with the bearer the host just renewed: a real
      // rejection, with no second verdict and no bump (as client.ts's
      // `authenticatedFetchAfterRefresh`).
      if (!session) throw new AuthenticationError('Authentication required');
    }

    // Log session creation/resumption
    if (session.session_resumed) {
      log.info('Session resumed:', session.session_id);
    } else {
      log.info('New session created:', session.session_id);
    }

    return session;
  }

  /**
   * The minted session if it is `expectedOwner`'s; `null` when the credential
   * was rejected (a 401, or a session minted for someone else). Any other
   * failure throws.
   */
  private async ownedSession(
    response: Response,
    expectedOwner: string,
  ): Promise<SessionCreateResponse | null> {
    if (response.status === 401) return null;
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      // `detail` is FastAPI's key; `message` is the one the protection
      // middleware uses, and a rate-limited session create is answered by the
      // protection middleware — so reading `detail` alone showed "Failed to
      // create session: 429" and threw away what the server said (fm#994).
      const error: any = new Error(
        errorBodyText(errorData) || `Failed to create session: ${response.status}`
      );
      // Carry the status and the server's own window, in the shape
      // `ErrorClassifier` reads. Without them a 429 here classifies as a
      // generic error: no RateLimitError, so no "we'll try again in N
      // seconds" and no Retry-After honoured by the resilient-operation
      // wrapper — it would retry on plain backoff and burn its attempts.
      error.status = response.status;
      const retryAfter = response.headers?.get?.('Retry-After');
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        if (Number.isFinite(seconds)) error.retryAfter = seconds;
      }
      throw error;
    }

    const sessionResponse: SessionCreateResponse = await response.json();
    if (sessionResponse.user_id !== expectedOwner) {
      log.warn('Session minted for another user; treating the credential as rejected');
      return null;
    }
    return sessionResponse;
  }

  /**
   * Clear client ID to force creation of new session
   * Note: This is primarily used internally for session expiration recovery.
   * UI no longer exposes manual session forcing to users.
   */
  async clearClientId(): Promise<void> {
    this.clientId = null;

    await ownedStorage.remove([ClientSessionManager.CLIENT_ID_KEY]);
    
    log.info('Client ID cleared - next session will be new');
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
  async createSessionWithRecovery(
    expectedOwner: string,
    userContext?: any,
    timeoutMinutes?: number,
  ): Promise<SessionCreateResponse> {
    try {
      const response = await this.createSession(expectedOwner, userContext, timeoutMinutes);

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
        // At most one host verdict per ensure: the first attempt may already
        // have taken one.
        return await this.mint(expectedOwner, false, userContext, timeoutMinutes);
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
