import { queryOptions } from '@tanstack/react-query';
import type { CatalogService, SystemStatus, SessionView } from '@clarix/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(15000),
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(
      response.status,
      typeof body?.message === 'string'
        ? body.message
        : `Request failed (${response.status}). Please try again.`,
    );
  }
  return response.json() as Promise<T>;
}
export function postJson<T>(
  path: string,
  body: unknown,
  csrfToken?: string,
  headers: Record<string, string> = {},
) {
  return fetchJson<T>(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async () => {
    try {
      return await fetchJson<SessionView>('/api/auth/session');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  staleTime: 30000,
  refetchInterval: 60000,
  retry: false,
});
export const catalogQuery = queryOptions({
  queryKey: ['catalog'],
  queryFn: () => fetchJson<{ data: CatalogService[] }>('/api/services'),
  staleTime: 30000,
});
export const statusQuery = queryOptions({
  queryKey: ['status'],
  queryFn: () => fetchJson<SystemStatus>('/api/status'),
  refetchInterval: 10000,
});
