"""Read-only data every logged-in user needs: leave types, public holidays, own balances."""

from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import extract, select

from app.api.deps import CurrentUser, DbSession
from app.core import clock
from app.models import LeaveType, PublicHoliday
from app.schemas.leave import BalanceOut, HolidayOut, LeaveTypeOut
from app.services import balance_service

router = APIRouter(tags=["Reference data"])

Year = Annotated[int | None, Query(ge=2000, le=2100, description="Defaults to the current year")]


@router.get("/leave-types", response_model=list[LeaveTypeOut])
def list_active_leave_types(_: CurrentUser, db: DbSession) -> list[LeaveType]:
    return list(db.scalars(select(LeaveType).where(LeaveType.is_active.is_(True)).order_by(LeaveType.name)))


@router.get("/holidays", response_model=list[HolidayOut])
def list_holidays(_: CurrentUser, db: DbSession, year: Year = None) -> list[PublicHoliday]:
    stmt = select(PublicHoliday).order_by(PublicHoliday.holiday_date)
    if year is not None:
        stmt = stmt.where(extract("year", PublicHoliday.holiday_date) == year)
    return list(db.scalars(stmt))


@router.get("/me/balances", response_model=list[BalanceOut], tags=["Employee"])
def my_balances(user: CurrentUser, db: DbSession, year: Year = None) -> list[BalanceOut]:
    """Balance per active leave type: allocated, used (approved), pending (reserved) and available."""
    summaries = balance_service.summaries_for_user(db, user.id, year or clock.today().year)
    return [BalanceOut.from_summary(s) for s in summaries]
