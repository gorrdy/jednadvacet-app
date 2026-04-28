// Minimal typed fetch wrapper. Collapses the try / !r.ok / r.json() /
// catch ladder that api.ts repeated ~20 times. Consistent error shape so
// the UI can do `if ("error" in r) ...` everywhere.

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ||
  (typeof location !== "undefined" ? "" : "");

export type ApiResult<T> = T | ApiError;
export interface ApiError { error: string; status?: number }

export function isApiError<T>(r: ApiResult<T>): r is ApiError {
  return r !== null && typeof r === "object" && "error" in r;
}

interface RequestOpts {
  token?: string;
  headers?: Record<string, string>;
}

async function request<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body: unknown,
  opts: RequestOpts,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  try {
    const r = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      credentials: "omit",
    });

    if (!r.ok) {
      // Try to get a structured error, but don't choke if the body isn't JSON.
      const fallback: ApiError = { error: `HTTP ${r.status}`, status: r.status };
      try {
        const j = (await r.json()) as { error?: string };
        return { error: j?.error ?? fallback.error, status: r.status };
      } catch {
        return fallback;
      }
    }
    // 204 No Content — return empty object.
    if (r.status === 204) return {} as T;
    return (await r.json()) as T;
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export const apiGet    = <T>(path: string, opts: RequestOpts = {}) => request<T>("GET", path, undefined, opts);
export const apiPost   = <T>(path: string, body: unknown, opts: RequestOpts = {}) => request<T>("POST", path, body, opts);
export const apiDelete = <T>(path: string, body?: unknown, opts: RequestOpts = {}) => request<T>("DELETE", path, body, opts);

/** Fallback variant: returns T | null. Useful where callers don't care about
 *  error shape (just want "did it succeed, here's the data or null"). */
export async function apiGetOrNull<T>(path: string, opts: RequestOpts = {}): Promise<T | null> {
  const r = await apiGet<T>(path, opts);
  return isApiError(r) ? null : r;
}
