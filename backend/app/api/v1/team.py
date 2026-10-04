from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import DbSession, ManagerOrAdmin
from app.core.errors import InvalidInputError
from app.models import LeaveStatus, UserRole
from app.core import clock
from app.schemas.leave import CalendarEntry, LeaveRequestOut, MemberLeaveSummary
from app.schemas.user import UserBrief
from app.services import leave_service

router = APIRouter(prefix="/team", tags=["Manager"])

MAX_CALENDAR_DAYS = 366


@router.get("/members", response_model=list[UserBrief])
def members(user: ManagerOrAdmin, db: DbSession):
    """People whose leave the caller approves (a manager's team; for the admin, everyone else)."""
    return leave_service.team_members(db, user)


@router.get("/leave-requests", response_model=list[LeaveRequestOut])
def team_requests(
    user: ManagerOrAdmin,
    db: DbSession,
    status_filter: Annotated[LeaveStatus | None, Query(alias="status")] = None,
    leave_type_id: int | None = None,
    employee_id: int | None = None,
    role: Annotated[UserRole | None, Query(description="Requester's role (employee or manager)")] = None,
    employee_active: Annotated[bool | None, Query(description="true: active users only; false: deactivated only")] = None,
    start_date: Annotated[date | None, Query(description="Requests overlapping this date or later")] = None,
    end_date: Annotated[date | None, Query(description="Requests overlapping this date or earlier")] = None,
):
    """Requests the caller can decide on: a manager's team, or everyone (except themselves) for the admin."""
    if start_date and end_date and end_date < start_date:
        raise InvalidInputError("end_date cannot be before start_date")
    rows = leave_service.list_for_approver(
        db, user, status_filter, leave_type_id=leave_type_id, employee_id=employee_id,
        role=role, employee_active=employee_active, start=start_date, end=end_date,
    )
    return [LeaveRequestOut.from_model(r) for r in rows]


@router.get("/leave-summary", response_model=list[MemberLeaveSummary])
def leave_summary(
    user: ManagerOrAdmin,
    db: DbSession,
    year: Annotated[int | None, Query(ge=2000, le=2100, description="Defaults to the current year")] = None,
    role: Annotated[UserRole | None, Query(description="Only people with this role")] = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
):
    """Leave overview per person: balance per leave type and request counts per status.

    Managers see their own team; the admin sees everyone except themselves.
    """
    return leave_service.team_summary(db, user, year or clock.today().year, role=role, search=search)


@router.get("/calendar", response_model=list[CalendarEntry])
def team_calendar(user: ManagerOrAdmin, db: DbSession,
                  start_date: Annotated[date, Query()], end_date: Annotated[date, Query()]):
    """Approved leave overlapping the range. Managers: their team and themselves. Admins: everyone."""
    if end_date < start_date:
        raise InvalidInputError("end_date cannot be before start_date")
    if (end_date - start_date).days > MAX_CALENDAR_DAYS:
        raise InvalidInputError(f"Date range cannot exceed {MAX_CALENDAR_DAYS} days")
    return [
        CalendarEntry(
            request_id=r.id, employee_id=r.employee_id, employee_name=r.employee.full_name,
            leave_type_code=r.leave_type.code, leave_type_name=r.leave_type.name,
            start_date=r.start_date, end_date=r.end_date, working_days=r.working_days,
        )
        for r in leave_service.calendar(db, user, start_date, end_date)
    ]
