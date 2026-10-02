import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import type { Role } from "../api/types";
import { useAuth } from "../auth/AuthContext";

interface NavItem {
  to: string;
  label: string;
  roles: Role[];
}

const ALL: Role[] = ["employee", "manager", "admin"];

// Visibility only - every endpoint is still authorised by the API.
export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "My leave",
    items: [
      { to: "/", label: "Dashboard", roles: ALL },
      { to: "/apply", label: "Apply for leave", roles: ALL },
      { to: "/history", label: "My requests", roles: ALL },
    ],
  },
  {
    title: "Team",
    items: [
      { to: "/approvals", label: "Approvals", roles: ["manager", "admin"] },
      { to: "/calendar", label: "Team calendar", roles: ["manager", "admin"] },
    ],
  },
  {
    title: "Administration",
    items: [
      { to: "/admin/users", label: "Users & managers", roles: ["admin"] },
      { to: "/admin/allowances", label: "Allowances", roles: ["admin"] },
      { to: "/admin/leave-types", label: "Leave types", roles: ["admin"] },
      { to: "/admin/holidays", label: "Public holidays", roles: ["admin"] },
      { to: "/admin/audit-log", label: "Audit log", roles: ["admin"] },
    ],
  },
];

const ROLE_LABEL: Record<Role, string> = { employee: "Employee", manager: "Manager", admin: "Admin" };

export function Layout() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  if (!user) return null;

  return (
    <div className="shell">
      <header className="topbar">
        <button
          type="button"
          className="icon-btn menu-toggle"
          aria-label="Toggle navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          ☰
        </button>
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">✓</span> Tawkeed Leave
        </span>
        <div className="topbar-user">
          <span className="user-name">{user.full_name}</span>
          <span className={`role-chip role-${user.role}`}>{ROLE_LABEL[user.role]}</span>
          <button type="button" className="btn btn-small btn-ghost" onClick={() => logout()}>
            Sign out
          </button>
        </div>
      </header>

      <nav className={`sidebar${menuOpen ? " open" : ""}`} aria-label="Main">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((i) => i.roles.includes(user.role));
          if (!items.length) return null;
          return (
            <div key={section.title} className="nav-section">
              <p className="nav-title">{section.title}</p>
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
