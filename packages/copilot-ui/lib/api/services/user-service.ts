/**
 * The signed-in user's profile.
 *
 * Split out of `auth-service`, which is the extension's logout and
 * token-revocation module: it holds a refresh token, clears the credential
 * store and messages the extension runtime. None of that is shared, but
 * `/auth/me` is — the account row renders it in both hosts — and importing one
 * dragged the whole credential stack into everything the shared UI touches.
 */
import { authenticatedFetchWithRetry } from '../client';
import { createHttpErrorFromResponse } from '../../errors/http-error';
import { getApiTransport } from '../transport';
import type { UserProfile } from '../types';

export async function getCurrentUser(): Promise<UserProfile> {
  const response = await authenticatedFetchWithRetry(
    `${await getApiTransport().baseUrl()}/api/v1/auth/me`,
    { method: 'GET', credentials: 'include' },
  );

  if (!response.ok) {
    throw await createHttpErrorFromResponse(response);
  }

  return response.json();
}
