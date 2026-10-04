import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { errorMessage } from "../../api/client";
import { adminApi, referenceApi } from "../../api/endpoints";
import type { Holiday } from "../../api/types";
import { Alert, EmptyState, ErrorAlert, Field, Modal, PageHeader, Spinner } from "../../components/ui";
import { formatDate, todayISO } from "../../lib/dates";

export function HolidaysPage() {
  const thisYear = Number(todayISO().slice(0, 4));
  const queryClient = useQueryClient();
  const [year, setYear] = useState(thisYear);
  const [editing, setEditing] = useState<Holiday | "new" | null>(null);
  const [deleting, setDeleting] = useState<Holiday | null>(null);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const holidays = useQuery({ queryKey: ["holidays", year], queryFn: () => referenceApi.holidays(year) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["holidays"] });

  const save = useMutation({
    mutationFn: () =>
      editing === "new"
        ? adminApi.createHoliday({ holiday_date: date, name: name.trim() })
        : adminApi.updateHoliday((editing as Holiday).id, { holiday_date: date, name: name.trim() }),
    onSuccess: (h) => {
      setFlash(`Saved ${h.name} (${formatDate(h.holiday_date)}).`);
      setEditing(null);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (h: Holiday) => adminApi.deleteHoliday(h.id),
    onSuccess: () => {
      setFlash(`Deleted ${deleting?.name}.`);
      setDeleting(null);
      refresh();
    },
  });

  function open(h: Holiday | "new") {
    save.reset();
    setEditing(h);
    setDate(h === "new" ? "" : h.holiday_date);
    setName(h === "new" ? "" : h.name);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <>
      <PageHeader
        title="Public holidays"
        subtitle="Holidays are excluded from working-day counts. Pending requests are recalculated when approved."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => open("new")}>
            Add holiday
          </button>
        }
      />
      {flash && <Alert kind="success">{flash}</Alert>}
      <div className="toolbar">
        <select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {holidays.isPending && <Spinner />}
      <ErrorAlert error={holidays.error} onRetry={() => holidays.refetch()} />
      {holidays.data &&
        (holidays.data.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="row-num">#</th>
                  <th>Date</th>
                  <th>Name</th>
                  <th className="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {holidays.data.map((h, i) => (
                  <tr key={h.id}>
                    <td data-label="#" className="row-num">{i + 1}</td>
                    <td data-label="Date">{formatDate(h.holiday_date)}</td>
                    <td data-label="Name">{h.name}</td>
                    <td data-label="Actions" className="actions-col">
                      <div className="btn-group">
                        <button type="button" className="btn btn-small btn-ghost" onClick={() => open(h)}>
                          Edit
                        </button>
                        <button type="button" className="btn btn-small btn-danger-ghost" onClick={() => { remove.reset(); setDeleting(h); }}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title={`No public holidays in ${year}`} />
        ))}

      {editing && (
        <Modal
          title={editing === "new" ? "Add public holiday" : "Edit public holiday"}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" form="holiday-form" className="btn btn-primary" disabled={save.isPending || !date || !name.trim()}>
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <form id="holiday-form" className="form" onSubmit={onSubmit} noValidate>
            <Field label="Date" htmlFor="h-date">
              <input id="h-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Name" htmlFor="h-name">
              <input id="h-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </Field>
            {save.error && <Alert kind="error">{errorMessage(save.error)}</Alert>}
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Delete public holiday"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" disabled={remove.isPending} onClick={() => remove.mutate(deleting)}>
                {remove.isPending ? "Deleting…" : "Delete"}
              </button>
            </>
          }
        >
          <p>
            Delete <strong>{deleting.name}</strong> on {formatDate(deleting.holiday_date)}? It will count as a working day for new requests.
          </p>
          {remove.error && <Alert kind="error">{errorMessage(remove.error)}</Alert>}
        </Modal>
      )}
    </>
  );
}
