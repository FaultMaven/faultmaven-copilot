import config, { getApiUrl } from "../../../config";
import { authenticatedFetch } from "../client";
import { APIError, KnowledgeDocument } from "../types";

export async function getKnowledgeDocument(documentId: string): Promise<KnowledgeDocument> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/knowledge/documents/${documentId}`, {
    method: 'GET'
  });

  if (!response.ok) {
    const errorData: APIError = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `Failed to get document: ${response.status}`);
  }

  return response.json();
}
