import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import type { Role } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "./ui";

/** Redirects to /login when signed out; shows "not allowed" for the wrong role (UI only - the API enforces). */
export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) {
    return (
      <EmptyState title="You don't have access to this page">
        This area is only available to {roles.join(" and ")} accounts.
      </EmptyState>
    );
  }
  return <>{children}</>;
}
