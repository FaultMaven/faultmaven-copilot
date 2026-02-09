import config, { getApiUrl } from "../../../config";
import { authenticatedFetch, prepareBody } from "../client";
import {
  APIError,
  CaseClosureRequest,
  CaseClosureResponse,
  CaseReport,
  ReportGenerationRequest,
  ReportGenerationResponse,
  ReportRecommendation
} from "../types";
import { createHttpErrorFromResponse } from "../../errors/http-error";

export async function getReportRecommendations(caseId: string): Promise<ReportRecommendation> {
  const response = await authenticatedFetch(
    `${await getApiUrl()}/api/v1/cases/${caseId}/report-recommendations`,
    {
      method: 'GET',
      credentials: 'include'
    }
  );

  if (!response.ok) {
    throw await createHttpErrorFromResponse(response);
  }

  return response.json();
}

export async function generateReports(
  caseId: string,
  request: ReportGenerationRequest
): Promise<ReportGenerationResponse> {
  const response = await authenticatedFetch(
    `${await getApiUrl()}/api/v1/cases/${caseId}/reports`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: prepareBody(request),
      credentials: 'include'
    }
  );

  if (!response.ok) {
    throw await createHttpErrorFromResponse(response);
  }

  return response.json();
}

export async function getCaseReports(
  caseId: string,
  includeHistory: boolean = false
): Promise<CaseReport[]> {
  const url = new URL(`${await getApiUrl()}/api/v1/cases/${caseId}/reports`);
  if (includeHistory) {
    url.searchParams.append('include_history', 'true');
  }

  const response = await authenticatedFetch(url.toString(), {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    throw await createHttpErrorFromResponse(response);
  }

  return response.json();
}

export async function downloadReport(
  caseId: string,
  reportId: string
): Promise<Blob> {
  const response = await authenticatedFetch(
    `${await getApiUrl()}/api/v1/cases/${caseId}/reports/${reportId}/download`,
    {
      method: 'GET',
      credentials: 'include'
    }
  );

  if (!response.ok) {
    throw await createHttpErrorFromResponse(response);
  }

  return response.blob();
}

export async function closeCase(
  caseId: string,
  request: CaseClosureRequest
): Promise<CaseClosureResponse> {
  const response = await authenticatedFetch(
    `${await getApiUrl()}/api/v1/cases/${caseId}/close`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: prepareBody(request),
      credentials: 'include'
    }
  );

  if (!response.ok) {
    throw await createHttpErrorFromResponse(response);
  }

  return response.json();
}
