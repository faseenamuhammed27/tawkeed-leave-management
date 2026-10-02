import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { API, USERS, mockApi, renderPage } from "../test/utils";
import { LoginPage } from "./LoginPage";

describe("LoginPage", () => {
  it("asks for both fields before calling the API", async () => {
    const { calls } = mockApi({});
    renderPage(<LoginPage />, { route: "/login", path: "/login" });
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your email and password.");
    expect(calls).toHaveLength(0);
  });

  it("shows the API's error for wrong credentials", async () => {
    mockApi({
      [`POST ${API}/auth/login`]: () => ({ status: 401, body: { detail: "Invalid email or password", code: "INVALID_CREDENTIALS" } }),
    });
    renderPage(<LoginPage />, { route: "/login", path: "/login" });
    await userEvent.type(screen.getByLabelText("Email"), "employee1@tawkeed.example");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  });

  it("shows the lockout message from the API", async () => {
    mockApi({
      [`POST ${API}/auth/login`]: () => ({
        status: 429,
        body: { detail: "Too many failed login attempts. Try again in 15 minute(s).", code: "TOO_MANY_LOGIN_ATTEMPTS" },
      }),
    });
    renderPage(<LoginPage />, { route: "/login", path: "/login" });
    await userEvent.type(screen.getByLabelText("Email"), "employee1@tawkeed.example");
    await userEvent.type(screen.getByLabelText("Password"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many failed login attempts");
  });

  it("stores the session and leaves the login page on success", async () => {
    const { calls } = mockApi({
      [`POST ${API}/auth/login`]: { access_token: "jwt", token_type: "bearer", expires_in: 1800, user: USERS.manager },
    });
    renderPage(<LoginPage />, { route: "/login", path: "/login" });
    await userEvent.type(screen.getByLabelText("Email"), "manager@tawkeed.example");
    await userEvent.type(screen.getByLabelText("Password"), "secret-pass");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Other screen")).toBeInTheDocument();
    expect(calls[0].body).toEqual({ email: "manager@tawkeed.example", password: "secret-pass" });
    expect(JSON.parse(localStorage.getItem("tawkeed.session")!).token).toBe("jwt");
  });
});
