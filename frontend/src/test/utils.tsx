import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";

import type { Role, User } from "../api/types";
import { AuthProvider } from "../auth/AuthContext";

export const USERS: Record<Role, User> = {
  employee: { id: 3, email: "employee1@tawkeed.example", full_name: "Sara Ahmed", role: "employee", manager_id: 2, manager_name: "Khalid Rahman", is_active: true },
  manager: { id: 2, email: "manager@tawkeed.example", full_name: "Khalid Rahman", role: "manager", manager_id: null, manager_name: null, is_active: true },
  admin: { id: 1, email: "admin@tawkeed.example", full_name: "Aisha Al Mansouri", role: "admin", manager_id: null, manager_name: null, is_active: true },
};

export function signIn(role: Role) {
  localStorage.setItem(
    "tawkeed.session",
    JSON.stringify({ token: `token-${role}`, user: USERS[role], expiresAt: Date.now() + 3_600_000 }),
  );
}

type Handler = (req: { method: string; url: URL; body: unknown }) => { status?: number; body?: unknown } | undefined;

/** Stubs global fetch. `routes` maps "METHOD /path" to a JSON body or a handler; unmatched calls fail the test. */
export function mockApi(routes: Record<string, unknown | Handler>) {
  const calls: { method: string; path: string; query: URLSearchParams; body: unknown; headers: Record<string, string> }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, query: url.searchParams, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes[`${method} ${url.pathname}`];
    if (route === undefined) {
      return new Response(JSON.stringify({ detail: `Unmocked ${method} ${url.pathname}`, code: "UNMOCKED" }), { status: 500 });
    }
    const result = typeof route === "function" ? (route as Handler)({ method, url, body }) ?? {} : { body: route };
    const status = result.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(result.body ?? {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

export function renderPage(ui: ReactElement, { route = "/", path = "/" }: { route?: string; path?: string } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <Routes>
            <Route path={path} element={ui} />
            <Route path="/login" element={<div>Login screen</div>} />
            <Route path="/history" element={<div>History screen</div>} />
            <Route path="*" element={<div>Other screen</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export const API = "/api/v1";
