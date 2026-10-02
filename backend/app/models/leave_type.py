from sqlalchemy import Boolean, CheckConstraint, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class LeaveType(TimestampMixin, Base):
    """A kind of leave (Annual, Sick, ...) with the default yearly allowance in whole days."""

    __tablename__ = "leave_types"
    __table_args__ = (
        CheckConstraint("default_annual_days BETWEEN 0 AND 366", name="default_annual_days_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    default_annual_days: Mapped[int] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    def __repr__(self) -> str:
        return f"<LeaveType id={self.id} code={self.code!r}>"
