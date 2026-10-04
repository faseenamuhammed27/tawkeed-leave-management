import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { errorMessage } from "../../api/client";
import { adminApi, type UserUpdateBody } from "../../api/endpoints";
import type { Role, User } from "../../api/types";
import { useAuth } from "../../auth/AuthContext";
import { Alert, EmptyState, ErrorAlert, Field, Modal, PageHeader, Spinner } from "../../components/ui";

const ROLES: Role[] = ["employee", "manager", "admin"];

interface FormState {
  email: string;
  full_name: string;
  password: string;
  role: Role;
  manager_id: string;
  is_active: boolean;
}

const EMPTY: FormState = { email: "", full_name: "", password: "", role: "employee", manager_id: "", is_active: true };

export function UsersPage() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [params] = useSearchParams();
  const initialRole = params.get("role") as Role | null;
  const [roleFilter, setRoleFilter] = useState<Role | "">(initialRole && ROLES.includes(initialRole) ? initialRole : "");
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [flash, setFlash] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ["admin-users", search, roleFilter],
    queryFn: () => adminApi.users({ search: search.trim() || undefined, role: roleFilter || undefined }),
  });
  const admins = useQuery({ queryKey: ["admin-users", "admins"], queryFn: () => adminApi.users({ role: "admin" }) });
  const managers = useQuery({
    queryKey: ["admin-users", "managers"],
    queryFn: () => adminApi.users({ role: "manager", is_active: true }),
  });

  const save = useMutation({
    mutationFn: async () => {
      const managerId = form.role === "employee" && form.manager_id ? Number(form.manager_id) : null;
      if (editing === "new") {
        return adminApi.createUser({
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          password: form.password,
          role: form.role,
          manager_id: managerId,
        });
      }
      const u = editing as User;
      const body: UserUpdateBody = {};
      if (form.full_name.trim() !== u.full_name) body.full_name = form.full_name.trim();
      if (form.role !== u.role) body.role = form.role;
      if (managerId !== u.manager_id) body.manager_id = managerId;
      if (form.is_active !== u.is_active) body.is_active = form.is_active;
      if (form.password) body.password = form.password;
      return adminApi.updateUser(u.id, body);
    },
    onSuccess: (u) => {
      setFlash(editing === "new" ? `Created ${u.full_name}.` : `Saved changes to ${u.full_name}.`);
      close();
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  function open(target: User | "new") {
    save.reset();
    setEditing(target);
    setForm(
      target === "new"
        ? EMPTY
        : {
            email: target.email,
            full_name: target.full_name,
            password: "",
            role: target.role,
            manager_id: target.manager_id ? String(target.manager_id) : "",
            is_active: target.is_active,
          },
    );
  }

  function close() {
    setEditing(null);
    save.reset();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const isNew = editing === "new";
  const isSelf = editing !== "new" && editing?.id === me?.id;
  // Only one admin account (decision D2); the API enforces it, the form just explains it.
  const adminTaken = (admins.data ?? []).some((a) => editing === "new" || a.id !== editing?.id);

  return (
    <>
      <PageHeader
        title="Users & managers"
        subtitle="Employees report to one manager. Managers' leave is approved by an admin."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => open("new")}>
            Add user
          </button>
        }
      />
      {flash && <Alert kind="success">{flash}</Alert>}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search name or email"
          aria-label="Search users"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Filter by role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as Role | "")}>
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r[0].toUpperCase() + r.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {users.isPending && <Spinner />}
      <ErrorAlert error={users.error} onRetry={() => users.refetch()} />
      {users.data &&
        (users.data.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="row-num">#</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Manager</th>
                  <th>Status</th>
                  <th className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u, i) => (
                  <tr key={u.id} className={u.is_active ? "" : "row-muted"}>
                    <td data-label="#" className="row-num">{i + 1}</td>
                    <td data-label="Name">{u.full_name}</td>
                    <td data-label="Email">{u.email}</td>
                    <td data-label="Role">
                      <span className={`role-chip role-${u.role}`}>{u.role}</span>
                    </td>
                    <td data-label="Manager">{u.manager_name ?? <span className="muted">—</span>}</td>
                    <td data-label="Status">{u.is_active ? "Active" : "Deactivated"}</td>
                    <td data-label="Actions" className="actions-col">
                      <button type="button" className="btn btn-small btn-ghost" onClick={() => open(u)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No users match your search" />
        ))}

      {editing && (
        <Modal
          title={isNew ? "Add user" : `Edit ${(editing as User).full_name}`}
          onClose={close}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={close}>
                Cancel
              </button>
              <button type="submit" form="user-form" className="btn btn-primary" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <form id="user-form" className="form" onSubmit={onSubmit} noValidate>
            <Field label="Full name" htmlFor="u-name">
              <input id="u-name" value={form.full_name} onChange={(e) => set("full_name", e.target.value)} required maxLength={150} />
            </Field>
            <Field label="Email" htmlFor="u-email" hint={isNew ? undefined : "Email addresses cannot be changed."}>
              <input id="u-email" type="email" value={form.email} disabled={!isNew} onChange={(e) => set("email", e.target.value)} required />
            </Field>
            <Field label={isNew ? "Password" : "New password (optional)"} htmlFor="u-password" hint="8–72 characters.">
              <input
                id="u-password"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                minLength={8}
                maxLength={72}
              />
            </Field>
            <div className="field-row">
              <Field label="Role" htmlFor="u-role" hint={isSelf ? "You cannot change your own role." : undefined}>
                <select id="u-role" value={form.role} disabled={isSelf} onChange={(e) => set("role", e.target.value as Role)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r} disabled={r === "admin" && adminTaken}>
                      {r[0].toUpperCase() + r.slice(1)}
                      {r === "admin" && adminTaken ? " (only one admin)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              {form.role === "employee" && (
                <Field label="Manager" htmlFor="u-manager">
                  <select id="u-manager" value={form.manager_id} onChange={(e) => set("manager_id", e.target.value)}>
                    <option value="">Select a manager…</option>
                    {(managers.data ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            {!isNew && (
              <label className="checkbox">
                <input type="checkbox" checked={form.is_active} disabled={isSelf} onChange={(e) => set("is_active", e.target.checked)} />
                Active (deactivated users cannot sign in)
              </label>
            )}
            {save.error && <Alert kind="error">{errorMessage(save.error)}</Alert>}
          </form>
        </Modal>
      )}
    </>
  );
}
