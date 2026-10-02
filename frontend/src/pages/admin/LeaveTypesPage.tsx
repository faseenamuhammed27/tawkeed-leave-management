import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { errorMessage } from "../../api/client";
import { adminApi } from "../../api/endpoints";
import type { LeaveType } from "../../api/types";
import { Alert, EmptyState, ErrorAlert, Field, Modal, PageHeader, Spinner } from "../../components/ui";

export function LeaveTypesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<LeaveType | "new" | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [days, setDays] = useState("0");
  const [active, setActive] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);

  const types = useQuery({ queryKey: ["admin-leave-types"], queryFn: adminApi.leaveTypes });

  const save = useMutation({
    mutationFn: () =>
      editing === "new"
        ? adminApi.createLeaveType({ code: code.trim(), name: name.trim(), default_annual_days: Number(days) })
        : adminApi.updateLeaveType((editing as LeaveType).id, { name: name.trim(), default_annual_days: Number(days), is_active: active }),
    onSuccess: (t) => {
      setFlash(`Saved ${t.name}.`);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["admin-leave-types"] });
      queryClient.invalidateQueries({ queryKey: ["leave-types"] });
    },
  });

  function open(t: LeaveType | "new") {
    save.reset();
    setEditing(t);
    setCode(t === "new" ? "" : t.code);
    setName(t === "new" ? "" : t.name);
    setDays(t === "new" ? "0" : String(t.default_annual_days));
    setActive(t === "new" ? true : t.is_active);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <>
      <PageHeader
        title="Leave types"
        subtitle="The default allowance applies to balances not yet created; adjust existing ones under Allowances."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => open("new")}>
            Add leave type
          </button>
        }
      />
      {flash && <Alert kind="success">{flash}</Alert>}
      {types.isPending && <Spinner />}
      <ErrorAlert error={types.error} onRetry={() => types.refetch()} />
      {types.data &&
        (types.data.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th className="num">Default days / year</th>
                  <th>Status</th>
                  <th className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {types.data.map((t) => (
                  <tr key={t.id} className={t.is_active ? "" : "row-muted"}>
                    <td data-label="Code">
                      <code>{t.code}</code>
                    </td>
                    <td data-label="Name">{t.name}</td>
                    <td data-label="Default days" className="num">{t.default_annual_days}</td>
                    <td data-label="Status">{t.is_active ? "Active" : "Inactive"}</td>
                    <td data-label="Actions" className="actions-col">
                      <button type="button" className="btn btn-small btn-ghost" onClick={() => open(t)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No leave types yet" />
        ))}

      {editing && (
        <Modal
          title={editing === "new" ? "Add leave type" : `Edit ${editing.name}`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" form="lt-form" className="btn btn-primary" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <form id="lt-form" className="form" onSubmit={onSubmit} noValidate>
            <Field label="Code" htmlFor="lt-code" hint="2–20 letters, digits or underscores, e.g. ANNUAL.">
              <input id="lt-code" value={code} disabled={editing !== "new"} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={20} />
            </Field>
            <Field label="Name" htmlFor="lt-name">
              <input id="lt-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </Field>
            <Field label="Default days per year" htmlFor="lt-days">
              <input id="lt-days" type="number" min={0} max={366} value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            {editing !== "new" && (
              <label className="checkbox">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                Active (inactive types cannot be requested)
              </label>
            )}
            {save.error && <Alert kind="error">{errorMessage(save.error)}</Alert>}
          </form>
        </Modal>
      )}
    </>
  );
}
