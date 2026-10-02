import { describe, expect, it, vi } from "vitest";

import { ApiError, configureClient, errorMessage, request } from "./client";

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("api client", () => {
  it("sends the bearer token and JSON body", async () => {
    configureClient({ getToken: () => "abc", onUnauthorized: () => {} });
    const fetchMock = stubFetch(200, { ok: true });
    await request("POST", "/api/v1/things", { body: { a: 1 } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer abc");
    expect(init.body).toBe('{"a":1}');
  });

  it("turns the API error shape into an ApiError with status and code", async () => {
    configureClient({ getToken: () => "abc", onUnauthorized: () => {} });
    stubFetch(400, { detail: "Insufficient Annual Leave balance", code: "INSUFFICIENT_BALANCE", available_days: 2 });
    const err = (await request("GET", "/x").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("INSUFFICIENT_BALANCE");
    expect(err.body.available_days).toBe(2);
    expect(errorMessage(err)).toBe("Insufficient Annual Leave balance");
  });

  it("formats field validation errors", async () => {
    configureClient({ getToken: () => null, onUnauthorized: () => {} });
    stubFetch(422, {
      detail: "Request validation failed",
      code: "VALIDATION_ERROR",
      errors: [{ field: "end_date", message: "Value error, end_date cannot be before start_date", type: "value_error" }],
    });
    const err = (await request("POST", "/x", { body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(errorMessage(err)).toBe("End date: end_date cannot be before start_date");
  });

  it("ends the session on 401 when a token was sent", async () => {
    const onUnauthorized = vi.fn();
    configureClient({ getToken: () => "expired", onUnauthorized });
    stubFetch(401, { detail: "Token has expired", code: "TOKEN_EXPIRED" });
    await expect(request("GET", "/x")).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it("does not end the session for a failed login (no token)", async () => {
    const onUnauthorized = vi.fn();
    configureClient({ getToken: () => "t", onUnauthorized });
    stubFetch(401, { detail: "Invalid email or password", code: "INVALID_CREDENTIALS" });
    await expect(request("POST", "/login", { auth: false, body: {} })).rejects.toThrow("Invalid email or password");
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it("reports network failures clearly", async () => {
    configureClient({ getToken: () => null, onUnauthorized: () => {} });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const err = (await request("GET", "/x").catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.message).toMatch(/Cannot reach the server/);
  });
});
