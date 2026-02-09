import config, { getApiUrl } from "../../../config";
import { authenticatedFetch } from "../client";
import { APIError, KnowledgeDocument } from "../types";
import { createHttpErrorFromResponse } from "../../errors/http-error";

export async function getKnowledgeDocument(documentId: string): Promise<KnowledgeDocument> {
  const response = await authenticatedFetch(`${await getApiUrl()}/api/v1/knowledge/documents/${documentId}`, {
    method: 'GET'
  });

  if (!response.ok) {
    throw await createHttpErrorFromResponse(response);
  }

  return response.json();
}
