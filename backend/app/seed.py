"""Demo data so the app is usable straight away. Safe to run repeatedly.

    python -m app.seed

Creates (only what is missing): 1 admin, 1 manager, 2 employees reporting to the manager,
3 leave types, a few sample public holidays, this year's balances, and two sample requests
(one pending for the manager to act on, one approved so the team calendar has an entry).
Demo passwords come from SEED_DEMO_PASSWORD; existing users are never modified.
"""

import sys
from datetime import date, timedelta

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.core import clock
from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import LeaveBalance, LeaveRequest, LeaveType, PublicHoliday, User, UserRole
from app.schemas.leave import LeaveRequestCreate
from app.services import leave_service

LEAVE_TYPES = [
    ("ANNUAL", "Annual Leave", 20),
    ("SICK", "Sick Leave", 10),
    ("COMPASSIONATE", "Compassionate Leave", 5),
]

# Sample UAE public holidays (illustrative; admins manage the real list in the app).
HOLIDAYS = [
    (date(2026, 12, 1), "Commemoration Day"),
    (date(2026, 12, 2), "National Day"),
    (date(2026, 12, 3), "National Day Holiday"),
    (date(2027, 1, 1), "New Year's Day"),
]

ADMIN = ("admin@tawkeed.example", "Aisha Al Mansouri", UserRole.ADMIN)
MANAGER = ("manager@tawkeed.example", "Khalid Rahman", UserRole.MANAGER)
EMPLOYEES = [
    ("employee1@tawkeed.example", "Sara Ahmed"),
    ("employee2@tawkeed.example", "Omar Farooq"),
]


def _get_or_create_user(db: Session, email: str, name: str, role: UserRole, password_hash: str,
                        manager: User | None = None) -> tuple[User, bool]:
    user = db.scalar(select(User).where(User.email == email))
    if user:
        return user, False
    user = User(email=email, full_name=name, role=role, password_hash=password_hash,
                manager_id=manager.id if manager else None)
    db.add(user)
    db.flush()
    return user, True


def _next_monday(day: date, weeks_ahead: int) -> date:
    return day + timedelta(days=(7 - day.weekday()) % 7 or 7) + timedelta(weeks=weeks_ahead - 1)


def seed(db: Session) -> list[str]:
    log: list[str] = []
    password = get_settings().seed_demo_password
    if password is None:
        raise SystemExit("SEED_DEMO_PASSWORD is not set; refusing to create demo users without a password.")
    password_hash = hash_password(password.get_secret_value())

    types = {}
    for code, name, days in LEAVE_TYPES:
        lt = db.scalar(select(LeaveType).where(LeaveType.code == code))
        if lt is None:
            lt = LeaveType(code=code, name=name, default_annual_days=days)
            db.add(lt)
            log.append(f"leave type {code}")
        types[code] = lt
    db.flush()

    for day, name in HOLIDAYS:
        if not db.scalar(select(exists().where(PublicHoliday.holiday_date == day))):
            db.add(PublicHoliday(holiday_date=day, name=name))
            log.append(f"holiday {day} {name}")

    admin, created = _get_or_create_user(db, *ADMIN, password_hash)
    log += [f"user {admin.email}"] if created else []
    manager, created = _get_or_create_user(db, *MANAGER, password_hash)
    log += [f"user {manager.email}"] if created else []
    employees = []
    for email, name in EMPLOYEES:
        emp, created = _get_or_create_user(db, email, name, UserRole.EMPLOYEE, password_hash, manager)
        employees.append(emp)
        log += [f"user {emp.email}"] if created else []

    year = clock.today().year
    for user in (admin, manager, *employees):
        for lt in types.values():
            has_row = db.scalar(select(exists().where(
                LeaveBalance.user_id == user.id, LeaveBalance.leave_type_id == lt.id, LeaveBalance.year == year)))
            if not has_row:
                db.add(LeaveBalance(user_id=user.id, leave_type_id=lt.id, year=year,
                                    allocated_days=lt.default_annual_days, used_days=0))
    db.commit()

    # Sample requests through the real service, so balances and the audit log stay consistent.
    if not db.scalar(select(exists().where(LeaveRequest.id.is_not(None)))):
        today = clock.today()
        pending_start = _next_monday(today, 1)
        approved_start = _next_monday(today, 2)
        if approved_start.year == today.year and (approved_start + timedelta(days=2)).year == today.year:
            sara, omar = employees
            leave_service.create_request(db, sara, LeaveRequestCreate(
                leave_type_id=types["ANNUAL"].id, start_date=pending_start,
                end_date=pending_start + timedelta(days=1), reason="Family visit"))
            req = leave_service.create_request(db, omar, LeaveRequestCreate(
                leave_type_id=types["ANNUAL"].id, start_date=approved_start,
                end_date=approved_start + timedelta(days=2), reason="Short trip"))
            leave_service.approve(db, manager, req.id, "Approved - enjoy")
            log.append("sample requests (1 pending, 1 approved)")
    return log


def main() -> None:
    with SessionLocal() as db:
        created = seed(db)
    if created:
        print("Seeded:\n  " + "\n  ".join(created))
    else:
        print("Nothing to do - demo data already present.")


if __name__ == "__main__":
    main()
    sys.exit(0)
