/**
 * A case 404 labelled `x-error-code: CASE_NOT_FOUND` (faultmaven#2806) is
 * `CaseNotFoundError` on any route, in both error shapes: the client's enriched
 * `Error` and an `HttpError` (after a credential refresh). A 404 without the
 * label, or with another, is classified by status as before.
 */
import { describe, it, expect } from 'vitest';
import { ErrorClassifier, CASE_NOT_FOUND } from '@faultmaven/copilot-ui/lib/errors/classifier';
import { CaseNotFoundError, PermissionError, ValidationError } from '@faultmaven/copilot-ui/lib/errors/types';
import { HttpError } from '@faultmaven/copilot-ui/lib/errors/http-error';

const enriched = (status: number, code?: string) =>
  Object.assign(new Error('Case not found or access denied'), { status, ...(code ? { headers: { 'x-error-code': code } } : {}) });
const typed = (status: number, code?: string) =>
  new HttpError(status, 'Case not found or access denied', undefined, undefined, code ? { 'x-error-code': code } : undefined);

describe.each([
  { shape: 'enriched Error', make: enriched },
  { shape: 'HttpError', make: typed },
])('$shape', ({ make }) => {
  it('404 CASE_NOT_FOUND → CaseNotFoundError: no retry, the ruled copy', () => {
    const classified = ErrorClassifier.classify(make(404, CASE_NOT_FOUND));
    expect(classified).toBeInstanceOf(CaseNotFoundError);
    expect(classified.recovery).toBe('graceful_degradation');
    expect(classified.userTitle).toBe('Case Not Found');
  });

  it.each([undefined, 'DOCUMENT_NOT_FOUND'])('404 labelled %s stays ValidationError', (code) => {
    expect(ErrorClassifier.classify(make(404, code))).toBeInstanceOf(ValidationError);
  });

  it('403 CASE_NOT_DRIVER is a PermissionError (its callers read the case back)', () => {
    expect(ErrorClassifier.classify(make(403, 'CASE_NOT_DRIVER'))).toBeInstanceOf(PermissionError);
  });
});
