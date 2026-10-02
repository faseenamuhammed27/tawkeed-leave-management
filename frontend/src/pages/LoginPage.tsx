import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { ApiError, errorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert } from "../components/ui";

export function LoginPage() {
  const { user, login, notice, clearNotice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    clearNotice();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== "/login" ? from : "/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "VALIDATION_ERROR" ? "Enter a valid email address." : errorMessage(err),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit} noValidate aria-label="Sign in">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">✓</span>
          <div>
            <h1>Tawkeed Leave Portal</h1>
            <p className="muted">Sign in to manage your leave</p>
          </div>
        </div>

        {notice && <Alert kind="info">{notice}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <p className="login-help muted">
          Demo accounts: admin@, manager@, employee1@ and employee2@tawkeed.example
        </p>
      </form>
    </div>
  );
}
