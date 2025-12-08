import { clientSessionManager } from "../session/client-session-manager";
import { Session } from "./types";

/**
 * Create a new session with client-based resumption support
 * Uses ClientSessionManager for automatic session resumption across browser restarts
 */
export async function createSession(metadata?: Record<string, any>): Promise<Session> {
  // Use ClientSessionManager for client-based session management
  const sessionResponse = await clientSessionManager.createSessionWithRecovery(metadata);

  // Return session in the expected format
  return {
    session_id: sessionResponse.session_id,
    created_at: sessionResponse.created_at,
    status: sessionResponse.status as 'active' | 'idle' | 'expired',
    last_activity: sessionResponse.last_activity,
    metadata: sessionResponse.metadata,
    user_id: sessionResponse.user_id,
    session_type: sessionResponse.session_type,
    client_id: sessionResponse.client_id,
    session_resumed: sessionResponse.session_resumed,
    message: sessionResponse.message
  };
}
