"""Admin setup: users (one manager level, D2), leave types, allowances, public holidays.

Configuration changes are written to the audit log too, so the admin can see who changed what.
"""

from collections.abc import Sequence
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.errors import BusinessRuleError, ConflictError, NotFoundError
from app.core.security import hash_password
from app.models import AuditAction, AuditLog, LeaveType, PublicHoliday, User, UserRole
from app.schemas.leave import BalanceSet, HolidayCreate, HolidayUpdate, LeaveTypeCreate, LeaveTypeUpdate
from app.schemas.user import UserCreate, UserUpdate
from app.services import audit_service, balance_service
from app.services.balance_service import BalanceSummary


def _commit_or_conflict(db: Session, message: str, code: str) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictError(message, code) from None


# ------------------------------------------------------------------ users

def _get_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found", "USER_NOT_FOUND")
    return user


def _validate_manager(db: Session, role: UserRole, manager_id: int | None, user_id: int | None = None) -> None:
    """D2: employees must report to an active manager; managers and admins report to nobody."""
    if role != UserRole.EMPLOYEE:
        if manager_id is not None:
            raise BusinessRuleError("Only employees can have a manager", "MANAGER_NOT_ALLOWED")
        return
    if manager_id is None:
        raise BusinessRuleError("Employees must be assigned a manager", "MANAGER_REQUIRED")
    if manager_id == user_id:
        raise BusinessRuleError("A user cannot be their own manager", "INVALID_MANAGER")
    manager = db.get(User, manager_id)
    if manager is None or manager.role != UserRole.MANAGER or not manager.is_active:
        raise BusinessRuleError("manager_id must refer to an active user with the manager role", "INVALID_MANAGER")


def _ensure_no_other_admin(db: Session, user_id: int | None = None) -> None:
    """D2: there is exactly one admin account (the Director)."""
    stmt = select(exists().where(User.role == UserRole.ADMIN))
    if user_id is not None:
        stmt = select(exists().where(User.role == UserRole.ADMIN, User.id != user_id))
    if db.scalar(stmt):
        raise ConflictError("There can only be one admin account", "ADMIN_ALREADY_EXISTS")


def _has_team(db: Session, manager_id: int) -> bool:
    return bool(db.scalar(select(exists().where(User.manager_id == manager_id))))


def list_users(db: Session, role: UserRole | None, is_active: bool | None, search: str | None) -> Sequence[User]:
    stmt = select(User).options(selectinload(User.manager)).order_by(User.full_name)
    if role is not None:
        stmt = stmt.where(User.role == role)
    if is_active is not None:
        stmt = stmt.where(User.is_active.is_(is_active))
    if search:
        pattern = f"%{search.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(User.full_name).like(pattern), User.email.like(pattern)))
    return db.scalars(stmt).all()


def get_user(db: Session, user_id: int) -> User:
    return _get_user(db, user_id)


def create_user(db: Session, actor: User, data: UserCreate) -> User:
    if db.scalar(select(exists().where(User.email == data.email))):
        raise ConflictError("A user with this email already exists", "EMAIL_TAKEN")
    _validate_manager(db, data.role, data.manager_id)
    if data.role == UserRole.ADMIN:
        _ensure_no_other_admin(db)

    user = User(
        email=data.email, full_name=data.full_name, password_hash=hash_password(data.password),
        role=data.role, manager_id=data.manager_id,
    )
    db.add(user)
    db.flush()
    audit_service.record(
        db, actor=actor, action=AuditAction.USER_CREATED, entity_type="user", entity_id=user.id,
        details={"email": user.email, "role": user.role.value, "manager_id": user.manager_id},
    )
    _commit_or_conflict(db, "A user with this email already exists", "EMAIL_TAKEN")
    return user


def update_user(db: Session, actor: User, user_id: int, data: UserUpdate) -> User:
    user = _get_user(db, user_id)
    fields = data.model_fields_set
    new_role = data.role if "role" in fields and data.role is not None else user.role

    if "manager_id" in fields:
        new_manager_id = data.manager_id
    else:
        # Keep the current manager for employees; drop it automatically when leaving the employee role.
        new_manager_id = user.manager_id if new_role == UserRole.EMPLOYEE else None
    deactivating = "is_active" in fields and data.is_active is False and user.is_active

    if user.id == actor.id and (new_role != user.role or deactivating):
        raise BusinessRuleError("You cannot change your own role or deactivate yourself", "CANNOT_MODIFY_SELF")
    if user.role == UserRole.MANAGER and (new_role != UserRole.MANAGER or deactivating) and _has_team(db, user.id):
        raise BusinessRuleError("Reassign this manager's team members first", "MANAGER_HAS_TEAM")
    _validate_manager(db, new_role, new_manager_id, user.id)
    if new_role == UserRole.ADMIN and user.role != UserRole.ADMIN:
        _ensure_no_other_admin(db, user.id)

    changes: dict[str, Any] = {}

    def _set(attr: str, value: Any) -> None:
        old = getattr(user, attr)
        if old != value:
            changes[attr] = {"from": getattr(old, "value", old), "to": getattr(value, "value", value)}
            setattr(user, attr, value)

    if "full_name" in fields and data.full_name is not None:
        _set("full_name", data.full_name)
    _set("role", new_role)
    _set("manager_id", new_manager_id)
    if "is_active" in fields and data.is_active is not None:
        _set("is_active", data.is_active)
    if "password" in fields and data.password is not None:
        user.password_hash = hash_password(data.password)
        user.failed_login_count = 0
        user.locked_until = None
        changes["password"] = "changed"

    if changes:
        audit_service.record(db, actor=actor, action=AuditAction.USER_UPDATED, entity_type="user",
                             entity_id=user.id, details=changes)
    db.commit()
    db.refresh(user)
    return user


# ------------------------------------------------------------------ balances

def user_balances(db: Session, user_id: int, year: int) -> list[BalanceSummary]:
    _get_user(db, user_id)
    return balance_service.summaries_for_user(db, user_id, year, include_inactive=True)


def set_allocation(db: Session, actor: User, user_id: int, data: BalanceSet) -> BalanceSummary:
    _get_user(db, user_id)
    leave_type = db.get(LeaveType, data.leave_type_id)
    if leave_type is None:
        raise NotFoundError("Leave type not found", "LEAVE_TYPE_NOT_FOUND")

    row = balance_service.get_or_create_balance_row(db, user_id, leave_type, data.year)
    if data.allocated_days < row.used_days:
        raise BusinessRuleError(
            f"Allowance cannot be lower than the {row.used_days} day(s) already used", "ALLOCATION_BELOW_USED"
        )
    old = row.allocated_days
    row.allocated_days = data.allocated_days
    audit_service.record(
        db, actor=actor, action=AuditAction.BALANCE_SET, entity_type="leave_balance", entity_id=row.id,
        details={"user_id": user_id, "leave_type": leave_type.code, "year": data.year,
                 "allocated_days": {"from": old, "to": data.allocated_days}},
    )
    db.commit()
    return balance_service.summary(db, user_id, leave_type, data.year)


# ------------------------------------------------------------------ leave types

def list_leave_types(db: Session) -> Sequence[LeaveType]:
    return db.scalars(select(LeaveType).order_by(LeaveType.name)).all()


def create_leave_type(db: Session, actor: User, data: LeaveTypeCreate) -> LeaveType:
    if db.scalar(select(exists().where(or_(LeaveType.code == data.code, func.lower(LeaveType.name) == data.name.lower())))):
        raise ConflictError("A leave type with this code or name already exists", "LEAVE_TYPE_EXISTS")
    lt = LeaveType(code=data.code, name=data.name, default_annual_days=data.default_annual_days)
    db.add(lt)
    db.flush()
    audit_service.record(db, actor=actor, action=AuditAction.LEAVE_TYPE_CREATED, entity_type="leave_type",
                         entity_id=lt.id, details=data.model_dump())
    _commit_or_conflict(db, "A leave type with this code or name already exists", "LEAVE_TYPE_EXISTS")
    return lt


def update_leave_type(db: Session, actor: User, leave_type_id: int, data: LeaveTypeUpdate) -> LeaveType:
    lt = db.get(LeaveType, leave_type_id)
    if lt is None:
        raise NotFoundError("Leave type not found", "LEAVE_TYPE_NOT_FOUND")
    changes = data.model_dump(exclude_unset=True, exclude_none=True)
    for attr, value in changes.items():
        setattr(lt, attr, value)
    if changes:
        audit_service.record(db, actor=actor, action=AuditAction.LEAVE_TYPE_UPDATED, entity_type="leave_type",
                             entity_id=lt.id, details=changes)
    _commit_or_conflict(db, "A leave type with this name already exists", "LEAVE_TYPE_EXISTS")
    db.refresh(lt)
    return lt


# ------------------------------------------------------------------ public holidays

def _get_holiday(db: Session, holiday_id: int) -> PublicHoliday:
    h = db.get(PublicHoliday, holiday_id)
    if h is None:
        raise NotFoundError("Public holiday not found", "HOLIDAY_NOT_FOUND")
    return h


def create_holiday(db: Session, actor: User, data: HolidayCreate) -> PublicHoliday:
    if db.scalar(select(exists().where(PublicHoliday.holiday_date == data.holiday_date))):
        raise ConflictError("A public holiday already exists on this date", "HOLIDAY_EXISTS")
    h = PublicHoliday(holiday_date=data.holiday_date, name=data.name)
    db.add(h)
    db.flush()
    audit_service.record(db, actor=actor, action=AuditAction.HOLIDAY_CREATED, entity_type="public_holiday",
                         entity_id=h.id, details={"date": str(h.holiday_date), "name": h.name})
    _commit_or_conflict(db, "A public holiday already exists on this date", "HOLIDAY_EXISTS")
    return h


def update_holiday(db: Session, actor: User, holiday_id: int, data: HolidayUpdate) -> PublicHoliday:
    h = _get_holiday(db, holiday_id)
    changes = data.model_dump(exclude_unset=True, exclude_none=True)
    for attr, value in changes.items():
        setattr(h, attr, value)
    if changes:
        audit_service.record(db, actor=actor, action=AuditAction.HOLIDAY_UPDATED, entity_type="public_holiday",
                             entity_id=h.id, details={k: str(v) for k, v in changes.items()})
    _commit_or_conflict(db, "A public holiday already exists on this date", "HOLIDAY_EXISTS")
    db.refresh(h)
    return h


def delete_holiday(db: Session, actor: User, holiday_id: int) -> None:
    h = _get_holiday(db, holiday_id)
    audit_service.record(db, actor=actor, action=AuditAction.HOLIDAY_DELETED, entity_type="public_holiday",
                         entity_id=h.id, details={"date": str(h.holiday_date), "name": h.name})
    db.delete(h)
    db.commit()


# ------------------------------------------------------------------ audit log

def _day_start_utc(day: date) -> datetime:
    """Midnight of `day` in the business timezone, as an aware datetime."""
    return datetime.combine(day, time.min, tzinfo=ZoneInfo(get_settings().app_timezone))


def audit_page(
    db: Session, *, action: str | None, actor_id: int | None, entity_type: str | None,
    entity_id: int | None, start_date: date | None = None, end_date: date | None = None,
    page: int, page_size: int,
) -> tuple[Sequence[AuditLog], int]:
    """Newest first. start_date/end_date are whole days in the business timezone (inclusive)."""
    stmt = select(AuditLog)
    if start_date is not None:
        stmt = stmt.where(AuditLog.created_at >= _day_start_utc(start_date))
    if end_date is not None:
        stmt = stmt.where(AuditLog.created_at < _day_start_utc(end_date + timedelta(days=1)))
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if actor_id is not None:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id is not None:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(
        stmt.options(selectinload(AuditLog.actor))
        .order_by(AuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return rows, int(total or 0)
