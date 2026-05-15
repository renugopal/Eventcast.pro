import { supabase } from './supabase';

/**
 * Thrown when the Supabase session is missing or expired.
 * Catch this in UI handlers to redirect to /login.
 */
export class AuthError extends Error {
  constructor(message = 'Your session has expired. Please log in again.') {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Drop-in replacement for fetch() that automatically attaches the current
 * Supabase session token in the Authorization header.
 *
 * Use this in every client component that calls an internal API route.
 * Content-Type is set to application/json automatically for requests with a body.
 *
 * @example
 *   import { authFetch } from '@/lib/client-auth';
 *
 *   const res = await authFetch('/api/events/generate', {
 *     method: 'POST',
 *     body: JSON.stringify(payload),
 *   });
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new AuthError();
  }

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
    Authorization: `Bearer ${session.access_token}`,
  };

  // Set Content-Type for requests that send a body (unless caller overrides it)
  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(url, { ...options, headers });
}
