import config from "../config";

// ===== TypeScript Interfaces =====

export interface Session {
  session_id: string;
  created_at: string;
  status: string;
}

export interface CreateSessionResponse {
  session_id: string;
  created_at: string;
}

export interface DataUploadResponse {
  data_id: string;
  filename?: string;
  insights?: string;
  status: string;
}

export interface QueryRequest {
  session_id: string;
  query: string;
  priority: "low" | "normal" | "high" | "critical";
  context: {
    uploaded_data_ids?: string[];
    page_url?: string;
    browser_info?: string;
    page_content?: string;
    text_data?: string;
    [key: string]: any;
  };
}

export interface TroubleshootingResponse {
  response: string;
  findings?: string[];
  recommendations?: string[];
  confidence_score?: number;
  session_id: string;
}

export interface KbDocument {
  id: string;
  name: string;
  status: 'Processing' | 'Indexed' | 'Error';
  addedAt: string;
}

// ===== Session Management =====
/**
 * Upload a document to the knowledge base
 */
export async function uploadKnowledgeDocument(file: File): Promise<KbDocument> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${config.apiUrl}/kb/documents`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Upload failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch all documents from the knowledge base
 */
export async function getKnowledgeDocuments(): Promise<KbDocument[]> {
  const response = await fetch(`${config.apiUrl}/kb/documents`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to fetch documents: ${response.status}`);
  }

  return response.json();
}

/**
 * Delete a document from the knowledge base
 */
export async function deleteKnowledgeDocument(id: string): Promise<void> {
  const response = await fetch(`${config.apiUrl}/kb/documents/${id}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to delete document: ${response.status}`);
  }
}

/**
 * Create a new session on the FaultMaven backend
 */
export async function createSession(user_id?: string): Promise<Session> {
  const url = new URL(`${config.apiUrl}/api/v1/sessions/`);
  if (user_id) {
    url.searchParams.append('user_id', user_id);
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.message || `Failed to create session: ${response.status}`);
  }

  return response.json();
}

/**
 * Process a query for troubleshooting
 */
export async function processQuery(request: QueryRequest): Promise<TroubleshootingResponse> {
  const response = await fetch(`${config.apiUrl}/api/v1/agent/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.message || `Failed to process query: ${response.status}`);
  }

  return response.json();
}

/**
 * Upload data to a session for analysis
 */
export async function uploadData(sessionId: string, data: File | string, dataType: 'file' | 'text' | 'page'): Promise<DataUploadResponse> {
  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('data_type', dataType);
  
  if (data instanceof File) {
    formData.append('file', data);
  } else {
    formData.append('content', data);
  }

  const response = await fetch(`${config.apiUrl}/api/v1/data/`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.message || `Failed to upload data: ${response.status}`);
  }

  return response.json();
}

/**
 * Delete a session
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`${config.apiUrl}/api/v1/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || errorData.message || `Failed to delete session: ${response.status}`);
  }
}

/**
 * Send heartbeat to keep session alive
 */
export async function heartbeatSession(sessionId: string): Promise<void> {
  const response = await fetch(`${config.apiUrl}/api/v1/sessions/${sessionId}/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Failed to heartbeat session: ${response.status}`);
  }
} 