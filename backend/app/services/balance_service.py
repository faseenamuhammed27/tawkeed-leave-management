"""Leave balances (decision D1).

  available = allocated_days - used_days - pending_days

- used_days is stored and only changes on approval (+) or on cancelling approved leave (-).
- pending_days is never stored; it is summed from the user's pending requests, so it can
  never drift out of sync. Pending requests reserve availability for validation only.
- A balance row is created lazily from the leave type's default allowance the first time
  it is needed for writing; reads fall back to the default without writing.
"""

from dataclasses import dataclass

from sqlalchemy import extract, func, select
from sqlalchemy.orm import Session

from app.models import LeaveBalance, LeaveRequest, LeaveStatus, LeaveType


@dataclass(frozen=True)
class BalanceSummary:
    leave_type: LeaveType
    year: int
    allocated_days: int
    used_days: int
    pending_days: int

    @property
    def available_days(self) -> int:
        return self.allocated_days - self.used_days - self.pending_days


def get_balance_row(db: Session, user_id: int, leave_type_id: int, year: int, *, lock: bool = False) -> LeaveBalance | None:
    stmt = select(LeaveBalance).where(
        LeaveBalance.user_id == user_id,
        LeaveBalance.leave_type_id == leave_type_id,
        LeaveBalance.year == year,
    )
    if lock:
        stmt = stmt.with_for_update()
    return db.scalar(stmt)


def get_or_create_balance_row(db: Session, user_id: int, leave_type: LeaveType, year: int) -> LeaveBalance:
    """Return the (locked) balance row, creating it from the type's default allowance if missing."""
    row = get_balance_row(db, user_id, leave_type.id, year, lock=True)
    if row is None:
        row = LeaveBalance(
            user_id=user_id, leave_type_id=leave_type.id, year=year,
            allocated_days=leave_type.default_annual_days, used_days=0,
        )
        db.add(row)
        db.flush()
    return row


def pending_days(db: Session, user_id: int, leave_type_id: int, year: int, *, exclude_request_id: int | None = None) -> int:
    stmt = select(func.coalesce(func.sum(LeaveRequest.working_days), 0)).where(
        LeaveRequest.employee_id == user_id,
        LeaveRequest.leave_type_id == leave_type_id,
        LeaveRequest.status == LeaveStatus.PENDING,
        extract("year", LeaveRequest.start_date) == year,
    )
    if exclude_request_id is not None:
        stmt = stmt.where(LeaveRequest.id != exclude_request_id)
    return int(db.scalar(stmt))


def summary(db: Session, user_id: int, leave_type: LeaveType, year: int) -> BalanceSummary:
    row = get_balance_row(db, user_id, leave_type.id, year)
    return BalanceSummary(
        leave_type=leave_type,
        year=year,
        allocated_days=row.allocated_days if row else leave_type.default_annual_days,
        used_days=row.used_days if row else 0,
        pending_days=pending_days(db, user_id, leave_type.id, year),
    )


def summaries_for_user(db: Session, user_id: int, year: int, *, include_inactive: bool = False) -> list[BalanceSummary]:
    stmt = select(LeaveType).order_by(LeaveType.name)
    if not include_inactive:
        stmt = stmt.where(LeaveType.is_active.is_(True))
    return [summary(db, user_id, lt, year) for lt in db.scalars(stmt)]
