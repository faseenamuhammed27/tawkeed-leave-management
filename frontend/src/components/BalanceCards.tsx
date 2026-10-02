import type { Balance } from "../api/types";

export function BalanceCards({ balances }: { balances: Balance[] }) {
  return (
    <div className="balance-grid">
      {balances.map((b) => {
        const usedPct = b.allocated_days ? Math.min(100, (b.used_days / b.allocated_days) * 100) : 0;
        const pendingPct = b.allocated_days ? Math.min(100 - usedPct, (b.pending_days / b.allocated_days) * 100) : 0;
        return (
          <article key={b.leave_type_id} className="balance-card" aria-label={`${b.leave_type_name} balance`}>
            <header>
              <h3>{b.leave_type_name}</h3>
              <span className="muted small">{b.year}</span>
            </header>
            <p className="balance-available">
              <span className="big-number">{b.available_days}</span>
              <span className="muted"> of {b.allocated_days} days available</span>
            </p>
            <div className="meter" aria-hidden="true">
              <span className="meter-used" style={{ width: `${usedPct}%` }} />
              <span className="meter-pending" style={{ width: `${pendingPct}%` }} />
            </div>
            <dl className="balance-breakdown">
              <div>
                <dt>Used</dt>
                <dd>{b.used_days}</dd>
              </div>
              <div>
                <dt>Pending</dt>
                <dd>{b.pending_days}</dd>
              </div>
              <div>
                <dt>Allocated</dt>
                <dd>{b.allocated_days}</dd>
              </div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}
