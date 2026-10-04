from datetime import date
from typing import Annotated

from fastapi import APIRouter, Body, Query, status

from app.api.deps import CurrentUser, DbSession, LeaveRequester, ManagerOrAdmin
from app.core import clock
from app.core.errors import InvalidInputError, NotFoundError
from app.models import LeaveStatus, LeaveType
from app.schemas.common import ErrorResponse
from app.schemas.leave import (
    CancelBody,
    DecisionBody,
    HolidayInRange,
    LeavePreviewOut,
    LeavePreviewQuery,
    LeaveRequestCreate,
    LeaveRequestOut,
    RejectBody,
)
from app.services import balance_service, leave_service
from app.services.working_days import working_days_for

router = APIRouter(prefix="/leave-requests", tags=["Leave requests"])

_E = {code: {"model": ErrorResponse} for code in (400, 401, 403, 404, 409, 422)}


@router.get("/preview", response_model=LeavePreviewOut, responses={422: {"model": ErrorResponse}})
def preview(user: CurrentUser, db: DbSession, q: Annotated[LeavePreviewQuery, Query()]) -> LeavePreviewOut:
    """Working-day count for a date range, used by the request form as dates are picked.

    Uses the same calculation as submitting, so the number shown is the number charged.
    """
    working, holidays = working_days_for(db, q.start_date, q.end_date)
    calendar_days = (q.end_date - q.start_date).days + 1
    weekday_holidays = sum(1 for h in holidays if h.holiday_date.weekday() < 5)
    result = LeavePreviewOut(
        start_date=q.start_date,
        end_date=q.end_date,
        working_days=working,
        calendar_days=calendar_days,
        weekend_days=calendar_days - working - weekday_holidays,
        holidays=[HolidayInRange(date=h.holiday_date, name=h.name) for h in holidays],
        starts_in_past=q.start_date < clock.today(),
    )
    if q.leave_type_id is not None:
        leave_type = db.get(LeaveType, q.leave_type_id)
        if leave_type is None:
            raise NotFoundError("Leave type not found", "LEAVE_TYPE_NOT_FOUND")
        available = balance_service.summary(db, user.id, leave_type, q.start_date.year).available_days
        result.available_days = available
        result.exceeds_balance = working > available
    return result


@router.get("/mine", response_model=list[LeaveRequestOut], responses={422: {"model": ErrorResponse}})
def my_requests(
    user: CurrentUser,
    db: DbSession,
    status_filter: Annotated[LeaveStatus | None, Query(alias="status")] = None,
    leave_type_id: int | None = None,
    start_date: Annotated[date | None, Query(description="Requests overlapping this date or later")] = None,
    end_date: Annotated[date | None, Query(description="Requests overlapping this date or earlier")] = None,
):
    """The caller's leave history, newest first, optionally filtered by status, leave type and dates."""
    if start_date and end_date and end_date < start_date:
        raise InvalidInputError("end_date cannot be before start_date")
    rows = leave_service.list_for_employee(
        db, user.id, status_filter, leave_type_id=leave_type_id, start=start_date, end=end_date,
    )
    return [LeaveRequestOut.from_model(r) for r in rows]


@router.post("", response_model=LeaveRequestOut, status_code=status.HTTP_201_CREATED, responses=_E)
def create_request(body: LeaveRequestCreate, user: LeaveRequester, db: DbSession):
    """Apply for leave (employees and managers; the admin does not request leave).

    Enforces working days, balance (incl. pending), overlaps and valid dates."""
    return LeaveRequestOut.from_model(leave_service.create_request(db, user, body))


@router.get("/{request_id}", response_model=LeaveRequestOut, responses=_E)
def get_request(request_id: int, user: CurrentUser, db: DbSession):
    """Visible to the employee, their manager and admins."""
    return LeaveRequestOut.from_model(leave_service.get_visible(db, user, request_id))


@router.post("/{request_id}/approve", response_model=LeaveRequestOut, responses=_E)
def approve_request(request_id: int, user: ManagerOrAdmin, db: DbSession,
                    body: Annotated[DecisionBody | None, Body()] = None):
    """Employees' requests: their own manager. Managers' and admins' requests: another admin."""
    return LeaveRequestOut.from_model(leave_service.approve(db, user, request_id, body.comment if body else None))


@router.post("/{request_id}/reject", response_model=LeaveRequestOut, responses=_E)
def reject_request(request_id: int, body: RejectBody, user: ManagerOrAdmin, db: DbSession):
    """Same approval rights as approve; a comment is required."""
    return LeaveRequestOut.from_model(leave_service.reject(db, user, request_id, body.comment))


@router.post("/{request_id}/cancel", response_model=LeaveRequestOut, responses=_E)
def cancel_request(request_id: int, user: CurrentUser, db: DbSession,
                   body: Annotated[CancelBody | None, Body()] = None):
    """Owner: pending, or approved before it starts. Admin: approved leave before it starts, reason required."""
    return LeaveRequestOut.from_model(leave_service.cancel(db, user, request_id, body.reason if body else None))
