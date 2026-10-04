from datetime import date, datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.models import LeaveRequest, LeaveStatus, UserRole
from app.schemas.common import APIModel, NonEmptyStr100, OptionalComment, ORMModel, RequiredComment
from app.services.balance_service import BalanceSummary

LeaveTypeCode = Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z0-9_]{2,20}$")]
AnnualDays = Annotated[int, Field(ge=0, le=366)]


# ------------------------------------------------------------------ leave types / holidays

class LeaveTypeOut(ORMModel):
    id: int
    code: str
    name: str
    default_annual_days: int
    is_active: bool


class LeaveTypeCreate(APIModel):
    code: LeaveTypeCode
    name: NonEmptyStr100
    default_annual_days: AnnualDays


class LeaveTypeUpdate(APIModel):
    name: NonEmptyStr100 | None = None
    default_annual_days: AnnualDays | None = None
    is_active: bool | None = None


class HolidayOut(ORMModel):
    id: int
    holiday_date: date
    name: str


class HolidayCreate(APIModel):
    holiday_date: date
    name: NonEmptyStr100


class HolidayUpdate(APIModel):
    holiday_date: date | None = None
    name: NonEmptyStr100 | None = None


# ------------------------------------------------------------------ balances

class BalanceOut(BaseModel):
    leave_type_id: int
    leave_type_code: str
    leave_type_name: str
    year: int
    allocated_days: int
    used_days: int
    pending_days: int
    available_days: int

    @classmethod
    def from_summary(cls, s: BalanceSummary) -> "BalanceOut":
        return cls(
            leave_type_id=s.leave_type.id, leave_type_code=s.leave_type.code, leave_type_name=s.leave_type.name,
            year=s.year, allocated_days=s.allocated_days, used_days=s.used_days,
            pending_days=s.pending_days, available_days=s.available_days,
        )


class BalanceSet(APIModel):
    leave_type_id: int
    year: int = Field(ge=2000, le=2100)
    allocated_days: AnnualDays


# ------------------------------------------------------------------ leave requests

class _DateRange(APIModel):
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def _check_range(self):
        # Rule 4 (part) and decision D5. "Not in the past" needs today's date, so the service checks it.
        if self.end_date < self.start_date:
            raise ValueError("end_date cannot be before start_date")
        if self.start_date.year != self.end_date.year:
            raise ValueError("A leave request must stay within one calendar year")
        return self


class LeaveRequestCreate(_DateRange):
    leave_type_id: int
    reason: OptionalComment


class LeavePreviewQuery(_DateRange):
    leave_type_id: int | None = None


class HolidayInRange(BaseModel):
    date: date
    name: str


class LeavePreviewOut(BaseModel):
    start_date: date
    end_date: date
    working_days: int
    calendar_days: int
    weekend_days: int
    holidays: list[HolidayInRange]
    starts_in_past: bool
    available_days: int | None = None
    exceeds_balance: bool | None = None


class DecisionBody(APIModel):
    comment: OptionalComment


class RejectBody(APIModel):
    comment: RequiredComment


class CancelBody(APIModel):
    reason: OptionalComment


class LeaveRequestOut(BaseModel):
    id: int
    employee_id: int
    employee_name: str
    employee_role: UserRole
    employee_is_active: bool
    leave_type_id: int
    leave_type_code: str
    leave_type_name: str
    start_date: date
    end_date: date
    working_days: int
    reason: str | None
    status: LeaveStatus
    decided_by_id: int | None
    decided_by_name: str | None
    decision_comment: str | None
    decided_at: datetime | None
    cancelled_by_id: int | None
    cancelled_by_name: str | None
    cancellation_reason: str | None
    cancelled_at: datetime | None
    created_at: datetime

    @classmethod
    def from_model(cls, r: LeaveRequest) -> "LeaveRequestOut":
        return cls(
            id=r.id, employee_id=r.employee_id, employee_name=r.employee.full_name,
            employee_role=r.employee.role, employee_is_active=r.employee.is_active,
            leave_type_id=r.leave_type_id, leave_type_code=r.leave_type.code, leave_type_name=r.leave_type.name,
            start_date=r.start_date, end_date=r.end_date, working_days=r.working_days, reason=r.reason,
            status=r.status,
            decided_by_id=r.decided_by_id, decided_by_name=r.decided_by.full_name if r.decided_by else None,
            decision_comment=r.decision_comment, decided_at=r.decided_at,
            cancelled_by_id=r.cancelled_by_id, cancelled_by_name=r.cancelled_by.full_name if r.cancelled_by else None,
            cancellation_reason=r.cancellation_reason, cancelled_at=r.cancelled_at,
            created_at=r.created_at,
        )


class StatusCounts(BaseModel):
    pending: int = 0
    approved: int = 0
    rejected: int = 0
    cancelled: int = 0


class MemberLeaveType(BaseModel):
    leave_type_id: int
    leave_type_code: str
    leave_type_name: str
    allocated_days: int
    used_days: int
    pending_days: int
    available_days: int
    requests: StatusCounts


class MemberLeaveSummary(BaseModel):
    id: int
    full_name: str
    email: str
    role: UserRole
    manager_name: str | None
    year: int
    leave_types: list[MemberLeaveType]
    totals: StatusCounts


class CalendarEntry(BaseModel):
    request_id: int
    employee_id: int
    employee_name: str
    leave_type_code: str
    leave_type_name: str
    start_date: date
    end_date: date
    working_days: int


class AuditLogOut(ORMModel):
    id: int
    actor_id: int | None
    actor_name: str | None = None
    action: str
    entity_type: str
    entity_id: int
    details: dict[str, Any]
    created_at: datetime
