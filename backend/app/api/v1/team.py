from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import DbSession, ManagerOrAdmin
from app.core.errors import InvalidInputError
from app.models import LeaveStatus
from app.schemas.leave import CalendarEntry, LeaveRequestOut
from app.schemas.user import UserBrief
from app.services import leave_service

router = APIRouter(prefix="/team", tags=["Manager"])

MAX_CALENDAR_DAYS = 366


@router.get("/members", response_model=list[UserBrief])
def members(user: ManagerOrAdmin, db: DbSession):
    """People whose leave the caller approves (a manager's team; for admins, managers and other admins)."""
    return leave_service.team_members(db, user)


@router.get("/leave-requests", response_model=list[LeaveRequestOut])
def team_requests(user: ManagerOrAdmin, db: DbSession,
                  status_filter: Annotated[LeaveStatus | None, Query(alias="status")] = None):
    return [LeaveRequestOut.from_model(r) for r in leave_service.list_for_approver(db, user, status_filter)]


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
