"""Leave request lifecycle. Every business rule from the brief is enforced here.

Rule 1  working days only           -> working_days_for() on submit and again on approval
Rule 2  sufficient balance          -> submit: days <= allocated - used - pending (D1)
                                       approve: used + days <= allocated
Rule 3  no overlaps                 -> _ensure_no_overlap() + DB exclusion constraint
Rule 4  valid dates                 -> schema (end >= start, D5 one year) + start >= today here
Rule 5  balance timing              -> used_days changes only on approve (+) / cancel approved (-)
Rule 6  approval rights             -> _ensure_can_decide() (D2) + DB check against self-approval
Rule 7  audit trail                 -> audit_service.record() in the same transaction

Concurrency: every write locks the employee's user row first (SELECT ... FOR UPDATE), so two
requests for the same employee are processed one after the other and the balance/overlap
checks cannot race.
"""

from collections.abc import Sequence
from datetime import date

from sqlalchemy import ColumnElement, and_, false, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core import clock
from app.core.errors import (
    BusinessRuleError,
    ConflictError,
    InvalidInputError,
    NotFoundError,
    PermissionDeniedError,
)
from app.models import AuditAction, LeaveRequest, LeaveStatus, LeaveType, User, UserRole
from app.models.enums import ACTIVE_LEAVE_STATUSES
from app.schemas.leave import LeaveRequestCreate
from app.services import audit_service, balance_service
from app.services.working_days import working_days_for

ENTITY = "leave_request"

_RELATIONS = (
    selectinload(LeaveRequest.employee),
    selectinload(LeaveRequest.leave_type),
    selectinload(LeaveRequest.decided_by),
    selectinload(LeaveRequest.cancelled_by),
)


# ------------------------------------------------------------------ helpers

def _lock_user(db: Session, user_id: int) -> None:
    db.execute(select(User.id).where(User.id == user_id).with_for_update())


def _get(db: Session, request_id: int) -> LeaveRequest:
    # populate_existing: after a change, reload relationships (e.g. decided_by) instead of reusing stale ones.
    req = db.scalar(
        select(LeaveRequest)
        .where(LeaveRequest.id == request_id)
        .options(*_RELATIONS)
        .execution_options(populate_existing=True)
    )
    if req is None:
        raise NotFoundError("Leave request not found", "LEAVE_REQUEST_NOT_FOUND")
    return req


def _get_locked(db: Session, request_id: int) -> LeaveRequest:
    """Load the request, then lock its employee and the request row before any checks."""
    req = _get(db, request_id)
    _lock_user(db, req.employee_id)
    db.refresh(req, with_for_update=True)
    return req


def _ensure_no_overlap(db: Session, employee_id: int, start: date, end: date) -> None:
    clash = db.scalar(
        select(LeaveRequest).where(
            LeaveRequest.employee_id == employee_id,
            LeaveRequest.status.in_(ACTIVE_LEAVE_STATUSES),
            LeaveRequest.start_date <= end,
            LeaveRequest.end_date >= start,
        ).limit(1)
    )
    if clash is not None:
        raise ConflictError(
            f"These dates overlap your {clash.status.value} request from {clash.start_date} to {clash.end_date}",
            "OVERLAPPING_REQUEST",
            extra={"conflicting_request_id": clash.id},
        )


def approver_scope(actor: User) -> ColumnElement[bool]:
    """SQL condition on User selecting whose requests `actor` may approve or reject (D2).

    - A manager handles their own team (employees whose manager_id is the manager).
    - The admin (Director) can act on anyone's request: managers' requests come to them, and they
      can step in on any employee's request (e.g. when the office manager is away).
    - Nobody handles their own requests.
    """
    if actor.role == UserRole.MANAGER:
        return and_(User.manager_id == actor.id, User.id != actor.id)
    if actor.role == UserRole.ADMIN:
        return User.id != actor.id
    return false()


def _ensure_can_decide(actor: User, employee: User) -> None:
    if actor.id == employee.id:
        raise PermissionDeniedError("You cannot approve or reject your own leave", "SELF_APPROVAL_FORBIDDEN")
    if actor.role == UserRole.ADMIN:
        return  # the admin can decide on any request except their own
    if employee.role == UserRole.EMPLOYEE:
        allowed = actor.role == UserRole.MANAGER and employee.manager_id == actor.id
        message = "Only the employee's own manager can decide on this request"
    else:
        allowed = False
        message = "Requests from managers are decided by the admin"
    if not allowed:
        raise PermissionDeniedError(message, "NOT_YOUR_TEAM")


def can_view(actor: User, req: LeaveRequest) -> bool:
    return (
        actor.id == req.employee_id
        or actor.role == UserRole.ADMIN
        or req.employee.manager_id == actor.id
    )


def _ensure_pending(req: LeaveRequest) -> None:
    if req.status != LeaveStatus.PENDING:
        raise ConflictError(f"This request is already {req.status.value}", "INVALID_STATUS",
                            extra={"current_status": req.status.value})


# ------------------------------------------------------------------ queries

def get_visible(db: Session, actor: User, request_id: int) -> LeaveRequest:
    req = _get(db, request_id)
    if not can_view(actor, req):
        raise PermissionDeniedError("You cannot view this leave request")
    return req


def list_for_employee(db: Session, user_id: int, status: LeaveStatus | None = None) -> Sequence[LeaveRequest]:
    stmt = select(LeaveRequest).where(LeaveRequest.employee_id == user_id).options(*_RELATIONS)
    if status is not None:
        stmt = stmt.where(LeaveRequest.status == status)
    return db.scalars(stmt.order_by(LeaveRequest.start_date.desc(), LeaveRequest.id.desc())).all()


def list_for_approver(
    db: Session,
    actor: User,
    status: LeaveStatus | None = None,
    *,
    leave_type_id: int | None = None,
    employee_id: int | None = None,
    role: UserRole | None = None,
    start: date | None = None,
    end: date | None = None,
) -> Sequence[LeaveRequest]:
    """Requests the actor may decide on, with optional filters.

    start/end select requests whose dates overlap the range.
    """
    stmt = (
        select(LeaveRequest)
        .join(User, LeaveRequest.employee_id == User.id)
        .where(approver_scope(actor))
        .options(*_RELATIONS)
    )
    if status is not None:
        stmt = stmt.where(LeaveRequest.status == status)
    if leave_type_id is not None:
        stmt = stmt.where(LeaveRequest.leave_type_id == leave_type_id)
    if employee_id is not None:
        stmt = stmt.where(LeaveRequest.employee_id == employee_id)
    if role is not None:
        stmt = stmt.where(User.role == role)
    if start is not None:
        stmt = stmt.where(LeaveRequest.end_date >= start)
    if end is not None:
        stmt = stmt.where(LeaveRequest.start_date <= end)
    return db.scalars(stmt.order_by(LeaveRequest.start_date, LeaveRequest.id)).all()


def team_members(db: Session, actor: User) -> Sequence[User]:
    return db.scalars(select(User).where(approver_scope(actor)).order_by(User.full_name)).all()


def calendar(db: Session, actor: User, start: date, end: date) -> Sequence[LeaveRequest]:
    """Approved leave overlapping [start, end].

    Managers see their team plus themselves; admins see everyone.
    """
    stmt = (
        select(LeaveRequest)
        .join(User, LeaveRequest.employee_id == User.id)
        .where(
            LeaveRequest.status == LeaveStatus.APPROVED,
            LeaveRequest.start_date <= end,
            LeaveRequest.end_date >= start,
        )
        .options(*_RELATIONS)
    )
    if actor.role != UserRole.ADMIN:
        stmt = stmt.where((User.manager_id == actor.id) | (User.id == actor.id))
    return db.scalars(stmt.order_by(LeaveRequest.start_date, User.full_name)).all()


# ------------------------------------------------------------------ commands

def create_request(db: Session, user: User, data: LeaveRequestCreate) -> LeaveRequest:
    if user.role == UserRole.ADMIN:  # D2: the admin is a setup role and does not request leave
        raise PermissionDeniedError("The admin account does not request leave", "ADMIN_CANNOT_REQUEST_LEAVE")
    leave_type = db.get(LeaveType, data.leave_type_id)
    if leave_type is None:
        raise NotFoundError("Leave type not found", "LEAVE_TYPE_NOT_FOUND")
    if not leave_type.is_active:
        raise BusinessRuleError("This leave type is no longer available", "LEAVE_TYPE_INACTIVE")

    # Rule 4: cannot start in the past (end >= start and D5 are checked by the schema).
    if data.start_date < clock.today():
        raise InvalidInputError("Leave cannot start in the past", "START_DATE_IN_PAST")

    _lock_user(db, user.id)

    # Rule 1
    days, _ = working_days_for(db, data.start_date, data.end_date)
    if days == 0:
        raise BusinessRuleError("The selected dates contain no working days", "NO_WORKING_DAYS")

    # Rule 3
    _ensure_no_overlap(db, user.id, data.start_date, data.end_date)

    # Rule 2 with D1: pending requests reserve availability.
    balance = balance_service.summary(db, user.id, leave_type, data.start_date.year)
    if days > balance.available_days:
        raise BusinessRuleError(
            f"Insufficient {leave_type.name} balance: requested {days} day(s), {balance.available_days} available",
            "INSUFFICIENT_BALANCE",
            extra={"requested_days": days, "available_days": balance.available_days},
        )

    req = LeaveRequest(
        employee_id=user.id, leave_type_id=leave_type.id,
        start_date=data.start_date, end_date=data.end_date,
        working_days=days, reason=data.reason or None, status=LeaveStatus.PENDING,
    )
    db.add(req)
    try:
        db.flush()
    except IntegrityError:  # pragma: no cover - only reachable if the row lock were bypassed
        db.rollback()
        raise ConflictError("These dates overlap an existing request", "OVERLAPPING_REQUEST") from None

    audit_service.record(
        db, actor=user, action=AuditAction.LEAVE_CREATED, entity_type=ENTITY, entity_id=req.id,
        details={"employee_id": user.id, "leave_type": leave_type.code, "start_date": str(req.start_date),
                 "end_date": str(req.end_date), "working_days": days},
    )
    db.commit()
    return _get(db, req.id)


def approve(db: Session, actor: User, request_id: int, comment: str | None) -> LeaveRequest:
    req = _get_locked(db, request_id)
    _ensure_can_decide(actor, req.employee)
    _ensure_pending(req)

    # Rule 1 again: holidays may have been added since the request was submitted.
    days, _ = working_days_for(db, req.start_date, req.end_date)
    if days == 0:
        raise BusinessRuleError("The requested dates no longer contain any working days", "NO_WORKING_DAYS")

    # Rule 2 at approval time: actual balance must cover it (allowance may have been lowered).
    row = balance_service.get_or_create_balance_row(db, req.employee_id, req.leave_type, req.start_date.year)
    remaining = row.allocated_days - row.used_days
    if days > remaining:
        raise BusinessRuleError(
            f"Insufficient balance to approve: {days} day(s) requested, {remaining} remaining",
            "INSUFFICIENT_BALANCE",
            extra={"requested_days": days, "available_days": remaining},
        )

    previous_days = req.working_days
    req.working_days = days
    req.status = LeaveStatus.APPROVED
    req.decided_by_id = actor.id
    req.decided_at = clock.now_utc()
    req.decision_comment = comment or None
    row.used_days += days  # Rule 5: deducted only now.

    audit_service.record(
        db, actor=actor, action=AuditAction.LEAVE_APPROVED, entity_type=ENTITY, entity_id=req.id,
        details={"employee_id": req.employee_id, "previous_status": "pending", "new_status": "approved",
                 "working_days": days, "recalculated_from": previous_days if previous_days != days else None,
                 "comment": req.decision_comment},
    )
    db.commit()
    return _get(db, req.id)


def reject(db: Session, actor: User, request_id: int, comment: str) -> LeaveRequest:
    req = _get_locked(db, request_id)
    _ensure_can_decide(actor, req.employee)
    _ensure_pending(req)

    req.status = LeaveStatus.REJECTED
    req.decided_by_id = actor.id
    req.decided_at = clock.now_utc()
    req.decision_comment = comment

    audit_service.record(
        db, actor=actor, action=AuditAction.LEAVE_REJECTED, entity_type=ENTITY, entity_id=req.id,
        details={"employee_id": req.employee_id, "previous_status": "pending", "new_status": "rejected",
                 "working_days": req.working_days, "comment": comment},
    )
    db.commit()
    return _get(db, req.id)


def cancel(db: Session, actor: User, request_id: int, reason: str | None) -> LeaveRequest:
    """Decision D3.

    - The employee can cancel their own pending leave, or their own approved leave before it starts.
    - An admin can cancel someone's approved leave (administrative correction), with a reason.
    - Managers cannot cancel their team's leave.
    - Nothing can be cancelled once it has started. Cancelling approved leave restores the balance.
    """
    req = _get(db, request_id)
    is_owner = actor.id == req.employee_id
    if not is_owner and actor.role != UserRole.ADMIN:
        raise PermissionDeniedError("Only the employee or an admin can cancel leave", "CANCEL_NOT_ALLOWED")

    _lock_user(db, req.employee_id)
    db.refresh(req, with_for_update=True)

    if req.status not in ACTIVE_LEAVE_STATUSES:
        raise ConflictError(f"This request is already {req.status.value}", "INVALID_STATUS",
                            extra={"current_status": req.status.value})
    if not is_owner:
        if req.status != LeaveStatus.APPROVED:
            raise ConflictError(
                "Admins can only cancel approved leave; pending requests are approved or rejected instead",
                "INVALID_STATUS", extra={"current_status": req.status.value},
            )
        if not reason:
            raise InvalidInputError("A reason is required when an admin cancels leave", "CANCELLATION_REASON_REQUIRED")
    if req.start_date <= clock.today():
        raise ConflictError("Leave cannot be cancelled once it has started", "LEAVE_ALREADY_STARTED")

    previous_status = req.status
    restored = 0
    if previous_status == LeaveStatus.APPROVED:
        row = balance_service.get_balance_row(db, req.employee_id, req.leave_type_id, req.start_date.year, lock=True)
        if row is not None:
            row.used_days -= req.working_days  # Rule 5: restore on cancelling approved leave.
            restored = req.working_days

    req.status = LeaveStatus.CANCELLED
    req.cancelled_by_id = actor.id
    req.cancelled_at = clock.now_utc()
    req.cancellation_reason = reason or None

    audit_service.record(
        db, actor=actor, action=AuditAction.LEAVE_CANCELLED, entity_type=ENTITY, entity_id=req.id,
        details={"employee_id": req.employee_id, "previous_status": previous_status.value, "new_status": "cancelled",
                 "working_days": req.working_days, "balance_restored_days": restored,
                 "administrative_correction": not is_owner, "reason": req.cancellation_reason},
    )
    db.commit()
    return _get(db, req.id)
