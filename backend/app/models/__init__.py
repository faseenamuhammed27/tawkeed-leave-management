"""Importing this package registers every model on Base.metadata (used by Alembic)."""

from app.models.audit_log import AuditLog
from app.models.enums import AuditAction, LeaveStatus, UserRole
from app.models.leave_balance import LeaveBalance
from app.models.leave_request import LeaveRequest
from app.models.leave_type import LeaveType
from app.models.public_holiday import PublicHoliday
from app.models.user import User

__all__ = [
    "AuditAction",
    "AuditLog",
    "LeaveBalance",
    "LeaveRequest",
    "LeaveStatus",
    "LeaveType",
    "PublicHoliday",
    "User",
    "UserRole",
]
