from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, String, func, text
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import LeaveStatus, pg_enum
from app.models.leave_type import LeaveType
from app.models.user import User


class LeaveRequest(TimestampMixin, Base):
    """A request for whole days of leave, inside a single calendar year.

    Business rules are enforced in the service layer; the constraints below are a safety
    net so that a bug or a race condition can never store invalid data.
    """

    __tablename__ = "leave_requests"
    __table_args__ = (
        CheckConstraint("end_date >= start_date", name="end_not_before_start"),
        CheckConstraint(
            "date_part('year', start_date) = date_part('year', end_date)", name="single_calendar_year"
        ),
        CheckConstraint("working_days > 0", name="working_days_positive"),
        # Rule 6 backstop: nobody can approve or reject their own leave.
        CheckConstraint(
            "decided_by_id IS NULL OR decided_by_id <> employee_id", name="not_self_decided"
        ),
        CheckConstraint(
            "status NOT IN ('approved', 'rejected') OR (decided_by_id IS NOT NULL AND decided_at IS NOT NULL)",
            name="decision_recorded",
        ),
        CheckConstraint(
            "status <> 'cancelled' OR (cancelled_by_id IS NOT NULL AND cancelled_at IS NOT NULL)",
            name="cancellation_recorded",
        ),
        Index("ix_leave_requests_employee_status", "employee_id", "status"),
        Index("ix_leave_requests_status_dates", "status", "start_date", "end_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    leave_type_id: Mapped[int] = mapped_column(ForeignKey("leave_types.id", ondelete="RESTRICT"))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    working_days: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[LeaveStatus] = mapped_column(
        pg_enum(LeaveStatus, "leave_status"), server_default=LeaveStatus.PENDING.value
    )

    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    decision_comment: Mapped[str | None] = mapped_column(String(500))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    cancelled_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    cancellation_reason: Mapped[str | None] = mapped_column(String(500))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    employee: Mapped[User] = relationship(foreign_keys=[employee_id])
    leave_type: Mapped[LeaveType] = relationship()
    decided_by: Mapped[User | None] = relationship(foreign_keys=[decided_by_id])
    cancelled_by: Mapped[User | None] = relationship(foreign_keys=[cancelled_by_id])

    def __repr__(self) -> str:
        return (
            f"<LeaveRequest id={self.id} employee={self.employee_id} "
            f"{self.start_date}..{self.end_date} {self.status.value}>"
        )


# Rule 3 backstop: an employee can never hold two pending/approved requests with overlapping
# dates, even if two requests race past the service check. Needs the btree_gist extension.
_t = LeaveRequest.__table__
_t.append_constraint(
    ExcludeConstraint(
        (_t.c.employee_id, "="),
        (func.daterange(_t.c.start_date, _t.c.end_date, text("'[]'")), "&&"),
        name="ex_leave_requests_no_overlap",
        using="gist",
        where=text("status IN ('pending', 'approved')"),
    )
)
