// Thin fetch wrapper: base URL from env, bearer token, and the API's error shape
// {"detail": "...", "code": "...", "errors"?: [{field, message}]} turned into ApiError.

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export interface FieldError {
  field: string | null;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldError[];
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    const detail = typeof body.detail === "string" ? body.detail : "Something went wrong";
    super(detail);
    this.status = status;
    this.code = typeof body.code === "string" ? body.code : "UNKNOWN_ERROR";
    this.fieldErrors = Array.isArray(body.errors) ? (body.errors as FieldError[]) : [];
    this.body = body;
  }
}

let tokenProvider: () => string | null = () => null;
let onUnauthorized: () => void = () => {};

export function configureClient(options: { getToken: () => string | null; onUnauthorized: () => void }) {
  tokenProvider = options.getToken;
  onUnauthorized = options.onUnauthorized;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function buildUrl(path: string, query?: Query): string {
  const url = new URL(API_BASE_URL + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; query?: Query; signal?: AbortSignal; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const token = options.auth === false ? null : tokenProvider();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, {
      detail: "Cannot reach the server. Check your connection; the server may also be waking up, so try again in a minute.",
      code: "NETWORK_ERROR",
    });
  }

  if (response.status === 204) return undefined as T;

  let body: Record<string, unknown> = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok) {
    // An expired or invalid token on an authenticated call ends the session.
    if (response.status === 401 && token) onUnauthorized();
    throw new ApiError(response.status, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>("GET", path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

/** A readable message for any error, including field-level validation messages. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.fieldErrors.length) {
      const fields = error.fieldErrors
        .map((e) => (e.field ? `${humanise(e.field)}: ${stripPrefix(e.message)}` : stripPrefix(e.message)))
        .join(" · ");
      return fields;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong";
}

function humanise(field: string) {
  const name = field.split(".").pop() ?? field;
  return name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function stripPrefix(message: string) {
  return message.replace(/^Value error, /, "");
}
