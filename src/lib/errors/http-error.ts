/**
 * HTTP Error Class
 *
 * Structured error type for HTTP responses with status codes.
 * Provides better error handling than string matching.
 */

import type { APIError } from '../api/types';

/**
 * Structured HTTP error with status code and detail message.
 *
 * @example
 * ```typescript
 * throw new HttpError(409, 'Duplicate request detected', 'Case already deleted');
 * ```
 */
export class HttpError extends Error {
  /**
   * HTTP status code (e.g., 404, 409, 500)
   */
  public readonly statusCode: number;

  /**
   * Detailed error information from API
   */
  public readonly detail?: string;

  /**
   * Original API error response
   */
  public readonly apiError?: APIError;

  /**
   * Optional response headers carried along with the error.
   * Lets callers read protocol-level signals like x-error-code,
   * x-expected-version, etc. without re-parsing the Response.
   */
  public readonly headers?: Record<string, string>;

  constructor(
    statusCode: number,
    message: string,
    detail?: string,
    apiError?: APIError,
    headers?: Record<string, string>
  ) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.detail = detail;
    this.apiError = apiError;
    this.headers = headers;

    // Maintains proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HttpError);
    }
  }

  /**
   * Alias for statusCode. The ErrorClassifier's HTTP-error detection
   * looks for a `status` property; keep the alias so HttpError flows
   * through the classifier path without a special case.
   */
  get status(): number {
    return this.statusCode;
  }

  /**
   * Check if error is a specific HTTP status code
   */
  is(statusCode: number): boolean {
    return this.statusCode === statusCode;
  }

  /**
   * Check if error is a client error (4xx)
   */
  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  /**
   * Check if error is a server error (5xx)
   */
  isServerError(): boolean {
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage(): string {
    return this.detail || this.message;
  }
}

/**
 * Extract error message from various error formats.
 *
 * Handles APIError, HttpError, Error, and unknown error types.
 *
 * @example
 * ```typescript
 * try {
 *   await apiCall();
 * } catch (error) {
 *   const message = extractErrorMessage(error);
 *   showError(message);
 * }
 * ```
 */
export function extractErrorMessage(error: unknown): string {
  // HttpError - use detail or message
  if (error instanceof HttpError) {
    return error.getUserMessage();
  }

  // Standard Error
  if (error instanceof Error) {
    return error.message;
  }

  // APIError object
  if (error && typeof error === 'object' && 'detail' in error) {
    return String((error as APIError).detail);
  }

  // Object with message property
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as any).message);
  }

  // Fallback to string conversion
  return String(error);
}

/**
 * Check if error is an HttpError with specific status code.
 *
 * @example
 * ```typescript
 * if (isHttpError(error, 409)) {
 *   // Handle conflict error
 * }
 * ```
 */
export function isHttpError(error: unknown, statusCode?: number): error is HttpError {
  if (!(error instanceof HttpError)) {
    return false;
  }

  if (statusCode !== undefined) {
    return error.statusCode === statusCode;
  }

  return true;
}

/**
 * Create HttpError from fetch Response.
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/endpoint');
 * if (!response.ok) {
 *   throw await createHttpErrorFromResponse(response);
 * }
 * ```
 */
export async function createHttpErrorFromResponse(response: Response): Promise<HttpError> {
  let apiError: APIError | undefined;
  let detail: string | undefined;

  try {
    const data = await response.json();
    if (data && typeof data === 'object') {
      apiError = data as APIError;
      detail = data.detail;
    }
  } catch {
    // Failed to parse JSON, use status text
    detail = response.statusText;
  }

  const message = detail || `HTTP ${response.status}: ${response.statusText}`;

  // Snapshot relevant signal headers so callers don't need the live
  // Response object after this point. The backend uses lowercase
  // names (x-error-code, x-expected-version, x-actual-version).
  // Guard against test mocks that omit `headers` entirely.
  const headers: Record<string, string> = {};
  if (response.headers && typeof response.headers.get === 'function') {
    for (const name of ['x-error-code', 'x-expected-version', 'x-actual-version']) {
      const value = response.headers.get(name);
      if (value !== null) headers[name] = value;
    }
  }

  return new HttpError(
    response.status,
    message,
    detail,
    apiError,
    Object.keys(headers).length > 0 ? headers : undefined
  );
}
