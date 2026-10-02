import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { errorMessage } from "../../api/client";
import { adminApi } from "../../api/endpoints";
import type { Balance } from "../../api/types";
import { Alert, EmptyState, ErrorAlert, PageHeader, Spinner } from "../../components/ui";
import { todayISO } from "../../lib/dates";

export function AllowancesPage() {
  const thisYear = Number(todayISO().slice(0, 4));
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<number | null>(null);
  const [year, setYear] = useState(thisYear);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [flash, setFlash] = useState<string | null>(null);

  const users = useQuery({ queryKey: ["admin-users", "active"], queryFn: () => adminApi.users({ is_active: true }) });
  useEffect(() => {
    if (userId === null && users.data?.length) setUserId(users.data[0].id);
  }, [users.data, userId]);

  const balances = useQuery({
    queryKey: ["admin-balances", userId, year],
    queryFn: () => adminApi.userBalances(userId!, year),
    enabled: userId !== null,
  });
  useEffect(() => setDrafts({}), [userId, year]);

  const save = useMutation({
    mutationFn: (b: Balance) =>
      adminApi.setAllowance(userId!, { leave_type_id: b.leave_type_id, year, allocated_days: Number(drafts[b.leave_type_id]) }),
    onSuccess: (b) => {
      setFlash(`${b.leave_type_name} allowance for ${year} set to ${b.allocated_days} days.`);
      setDrafts((d) => {
        const next = { ...d };
        delete next[b.leave_type_id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["admin-balances"] });
    },
  });

  const selectedName = users.data?.find((u) => u.id === userId)?.full_name;

  return (
    <>
      <PageHeader title="Allowances" subtitle="Yearly leave allowance per person and leave type." />
      {flash && <Alert kind="success">{flash}</Alert>}

      <div className="toolbar">
        <select aria-label="Employee" value={userId ?? ""} onChange={(e) => setUserId(Number(e.target.value))}>
          {(users.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.full_name} ({u.role})
            </option>
          ))}
        </select>
        <select aria-label="Year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {(users.isPending || balances.isPending) && userId !== null && <Spinner />}
      <ErrorAlert error={users.error ?? balances.error} />
      {save.error && <Alert kind="error">{errorMessage(save.error)}</Alert>}

      {balances.data &&
        (balances.data.length ? (
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">
                Allowances for {selectedName} in {year}
              </caption>
              <thead>
                <tr>
                  <th>Leave type</th>
                  <th className="num">Used</th>
                  <th className="num">Pending</th>
                  <th className="num">Available</th>
                  <th>Allocated days</th>
                </tr>
              </thead>
              <tbody>
                {balances.data.map((b) => {
                  const draft = drafts[b.leave_type_id];
                  const value = draft ?? String(b.allocated_days);
                  const n = Number(value);
                  const invalid = value === "" || !Number.isInteger(n) || n < 0 || n > 366;
                  const changed = draft !== undefined && n !== b.allocated_days;
                  return (
                    <tr key={b.leave_type_id}>
                      <td data-label="Leave type">{b.leave_type_name}</td>
                      <td data-label="Used" className="num">{b.used_days}</td>
                      <td data-label="Pending" className="num">{b.pending_days}</td>
                      <td data-label="Available" className="num">{b.available_days}</td>
                      <td data-label="Allocated">
                        <div className="inline-edit">
                          <input
                            type="number"
                            min={b.used_days}
                            max={366}
                            aria-label={`${b.leave_type_name} allocated days`}
                            value={value}
                            aria-invalid={invalid}
                            onChange={(e) => setDrafts((d) => ({ ...d, [b.leave_type_id]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="btn btn-small btn-primary"
                            disabled={!changed || invalid || save.isPending}
                            onClick={() => save.mutate(b)}
                          >
                            Save
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No leave types configured" />
        ))}
    </>
  );
}
