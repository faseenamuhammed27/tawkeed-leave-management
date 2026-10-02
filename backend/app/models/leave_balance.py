from sqlalchemy import CheckConstraint, ForeignKey, Integer, SmallInteger, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.leave_type import LeaveType
from app.models.user import User


class LeaveBalance(TimestampMixin, Base):
    """Yearly allowance per employee and leave type.

    used_days only changes on approval (+) and on cancelling approved leave (-).
    Pending reservations are not stored; they are summed from pending leave requests,
    so available = allocated_days - used_days - pending working days.
    """

    __tablename__ = "leave_balances"
    __table_args__ = (
        UniqueConstraint("user_id", "leave_type_id", "year"),
        CheckConstraint("year BETWEEN 2000 AND 2100", name="year_range"),
        CheckConstraint("allocated_days >= 0", name="allocated_days_non_negative"),
        CheckConstraint("used_days >= 0", name="used_days_non_negative"),
        CheckConstraint("used_days <= allocated_days", name="used_within_allocated"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    leave_type_id: Mapped[int] = mapped_column(ForeignKey("leave_types.id", ondelete="RESTRICT"))
    year: Mapped[int] = mapped_column(SmallInteger)
    allocated_days: Mapped[int] = mapped_column(Integer)
    used_days: Mapped[int] = mapped_column(Integer, server_default=text("0"))

    user: Mapped[User] = relationship()
    leave_type: Mapped[LeaveType] = relationship()

    def __repr__(self) -> str:
        return (
            f"<LeaveBalance user={self.user_id} type={self.leave_type_id} year={self.year} "
            f"{self.used_days}/{self.allocated_days}>"
        )
