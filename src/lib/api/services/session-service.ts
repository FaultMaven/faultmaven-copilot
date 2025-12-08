import config, { getApiUrl } from "../../../config";
import { authenticatedFetch } from "../client";
import { createFreshSession } from "../fetch-utils";
import { createSession } from "../session-core";
import { APIError, Session, UploadedData } from "../types";

// Re-export creation functions
export { createSession, createFreshSession };

export async function getSessionData(sessionId: string, limit: number = 10, offset: number = 0): Promise<UploadedData[]> {
  const url = new URL(`${await getApiUrl()}/api/v1/data/sessions/${sessionId}`);
  url.searchParams.append('limit', limit.toString());
  url.searchParams.append('offset', offset.toString());

  const response = await authenticatedFetch(url.toString(), {
    method: 'GET'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get session data: ${response.status}`);
  }

  const data = await response.json();
  // Ensure we always return an array
  return Array.isArray(data) ? data : [];
}

export async function getSession(sessionId: string): Promise<Session> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/sessions/${sessionId}`, {
    method: 'GET'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get session: ${response.status}`);
  }

  return response.json();
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/sessions/${sessionId}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to delete session: ${response.status}`);
  }
}

export async function heartbeatSession(sessionId: string): Promise<void> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/sessions/${sessionId}/heartbeat`, {
    method: 'POST',
    credentials: 'include'
  });
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to heartbeat session: ${response.status}`);
  }
}

export async function listSessions(filters?: {
  user_id?: string;
  session_type?: string;
  usage_type?: string;
  limit?: number;
  offset?: number;
}): Promise<Session[]> {
  const url = new URL(`${await getApiUrl()}/api/v1/sessions/`);
  if (filters) {
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.append(k, String(v));
    });
  }
  const response = await authenticatedFetch(url.toString(), { method: 'GET' });
  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to list sessions: ${response.status}`);
  }
  const data = await response.json().catch(() => []);
  if (Array.isArray(data)) return data as Session[];
  if (data && Array.isArray(data.sessions)) return data.sessions as Session[];
  if (data && Array.isArray(data.items)) return data.items as Session[];
  return [];
}
