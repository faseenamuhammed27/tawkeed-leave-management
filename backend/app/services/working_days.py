"""Rule 1: leave counts working days only (Mon-Fri, excluding public holidays)."""

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PublicHoliday

SATURDAY, SUNDAY = 5, 6


def count_working_days(start: date, end: date, holidays: set[date]) -> int:
    """Inclusive count of days in [start, end] that are neither weekend nor public holiday.

    A holiday falling on a weekend is not subtracted twice.
    """
    if end < start:
        return 0
    days = 0
    current = start
    while current <= end:
        if current.weekday() not in (SATURDAY, SUNDAY) and current not in holidays:
            days += 1
        current += timedelta(days=1)
    return days


def holidays_between(db: Session, start: date, end: date) -> list[PublicHoliday]:
    return list(
        db.scalars(
            select(PublicHoliday)
            .where(PublicHoliday.holiday_date.between(start, end))
            .order_by(PublicHoliday.holiday_date)
        )
    )


def working_days_for(db: Session, start: date, end: date) -> tuple[int, list[PublicHoliday]]:
    holidays = holidays_between(db, start, end)
    return count_working_days(start, end, {h.holiday_date for h in holidays}), holidays
