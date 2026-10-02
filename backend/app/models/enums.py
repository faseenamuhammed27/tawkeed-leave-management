import enum

from sqlalchemy import Enum as SAEnum


class UserRole(str, enum.Enum):
    EMPLOYEE = "employee"
    MANAGER = "manager"
    ADMIN = "admin"


class LeaveStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


# Statuses that occupy dates (overlap rule) and reserve balance (pending) or consume it (approved).
ACTIVE_LEAVE_STATUSES = (LeaveStatus.PENDING, LeaveStatus.APPROVED)


class AuditAction(str, enum.Enum):
    LEAVE_CREATED = "leave_request.created"
    LEAVE_APPROVED = "leave_request.approved"
    LEAVE_REJECTED = "leave_request.rejected"
    LEAVE_CANCELLED = "leave_request.cancelled"
    USER_CREATED = "user.created"
    USER_UPDATED = "user.updated"
    BALANCE_SET = "leave_balance.set"
    LEAVE_TYPE_CREATED = "leave_type.created"
    LEAVE_TYPE_UPDATED = "leave_type.updated"
    HOLIDAY_CREATED = "public_holiday.created"
    HOLIDAY_UPDATED = "public_holiday.updated"
    HOLIDAY_DELETED = "public_holiday.deleted"


def pg_enum(enum_cls: type[enum.Enum], name: str) -> SAEnum:
    """Native PostgreSQL enum that stores the lowercase values, not the Python member names."""
    return SAEnum(enum_cls, name=name, values_callable=lambda members: [m.value for m in members])
