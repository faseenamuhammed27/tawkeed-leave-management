from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession
from app.core import clock
from app.core.errors import NotFoundError
from app.models import LeaveType
from app.schemas.common import ErrorResponse
from app.schemas.leave import HolidayInRange, LeavePreviewOut, LeavePreviewQuery
from app.services import balance_service
from app.services.working_days import working_days_for

router = APIRouter(prefix="/leave-requests", tags=["Leave requests"])


@router.get("/preview", response_model=LeavePreviewOut, responses={422: {"model": ErrorResponse}})
def preview(user: CurrentUser, db: DbSession, q: Annotated[LeavePreviewQuery, Query()]) -> LeavePreviewOut:
    """Working-day count for a date range, used by the request form as dates are picked.

    Uses the same calculation as submitting, so the number shown is the number charged.
    """
    working, holidays = working_days_for(db, q.start_date, q.end_date)
    calendar_days = (q.end_date - q.start_date).days + 1
    weekdays_holidays = sum(1 for h in holidays if h.holiday_date.weekday() < 5)
    result = LeavePreviewOut(
        start_date=q.start_date,
        end_date=q.end_date,
        working_days=working,
        calendar_days=calendar_days,
        weekend_days=calendar_days - working - weekdays_holidays,
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
