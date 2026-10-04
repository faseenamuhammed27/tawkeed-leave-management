from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin
from app.models.enums import UserRole, pg_enum


class User(TimestampMixin, Base):
    """An employee, manager or admin.

    One manager level only: employees must have a manager; managers and the admin never do.
    That the referenced user really is a manager is enforced in the service layer.
    There is exactly one admin account (the Director); a partial unique index enforces it.
    """

    __tablename__ = "users"
    __table_args__ = (
        # Emails are normalised to lowercase by the service, so a plain unique constraint is enough.
        CheckConstraint("email = lower(email)", name="email_lowercase"),
        CheckConstraint("manager_id IS NULL OR manager_id <> id", name="not_self_managed"),
        CheckConstraint(
            "(role = 'employee' AND manager_id IS NOT NULL) OR (role <> 'employee' AND manager_id IS NULL)",
            name="manager_only_for_employees",
        ),
        CheckConstraint("failed_login_count >= 0", name="failed_login_count_non_negative"),
        Index("uq_users_single_admin", "role", unique=True, postgresql_where=text("role = 'admin'")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    full_name: Mapped[str] = mapped_column(String(150))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(pg_enum(UserRole, "user_role"))
    manager_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    # Failed-login lockout state.
    failed_login_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    manager: Mapped["User | None"] = relationship(
        remote_side=[id], back_populates="team_members"
    )
    team_members: Mapped[list["User"]] = relationship(back_populates="manager")

    @property
    def manager_name(self) -> str | None:
        return self.manager.full_name if self.manager else None

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email!r} role={self.role.value}>"
