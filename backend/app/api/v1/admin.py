from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.deps import AdminUser, DbSession
from app.core import clock
from app.models import UserRole
from app.schemas.common import ErrorResponse, Page
from app.schemas.leave import (
    AuditLogOut,
    BalanceOut,
    BalanceSet,
    HolidayCreate,
    HolidayOut,
    HolidayUpdate,
    LeaveTypeCreate,
    LeaveTypeOut,
    LeaveTypeUpdate,
)
from app.schemas.user import UserCreate, UserOut, UserUpdate
from app.services import admin_service

router = APIRouter(prefix="/admin", tags=["Admin"])

_E = {code: {"model": ErrorResponse} for code in (400, 401, 403, 404, 409, 422)}


# ------------------------------------------------------------------ users

@router.get("/users", response_model=list[UserOut])
def list_users(
    _: AdminUser, db: DbSession,
    role: UserRole | None = None,
    is_active: bool | None = None,
    search: Annotated[str | None, Query(max_length=100)] = None,
):
    return admin_service.list_users(db, role, is_active, search)


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED, responses=_E)
def create_user(body: UserCreate, admin: AdminUser, db: DbSession):
    """Employees need `manager_id` (an active manager). Managers and admins must not have one."""
    return admin_service.create_user(db, admin, body)


@router.get("/users/{user_id}", response_model=UserOut, responses=_E)
def get_user(user_id: int, _: AdminUser, db: DbSession):
    return admin_service.get_user(db, user_id)


@router.patch("/users/{user_id}", response_model=UserOut, responses=_E)
def update_user(user_id: int, body: UserUpdate, admin: AdminUser, db: DbSession):
    """Change name, role, manager, active flag or password. Users are deactivated, never deleted."""
    return admin_service.update_user(db, admin, user_id, body)


@router.get("/users/{user_id}/balances", response_model=list[BalanceOut], responses=_E)
def user_balances(user_id: int, _: AdminUser, db: DbSession,
                  year: Annotated[int | None, Query(ge=2000, le=2100)] = None):
    return [BalanceOut.from_summary(s) for s in admin_service.user_balances(db, user_id, year or clock.today().year)]


@router.put("/users/{user_id}/balances", response_model=BalanceOut, responses=_E)
def set_user_allowance(user_id: int, body: BalanceSet, admin: AdminUser, db: DbSession):
    """Set the yearly allowance for one employee and leave type (cannot go below days already used)."""
    return BalanceOut.from_summary(admin_service.set_allocation(db, admin, user_id, body))


# ------------------------------------------------------------------ leave types

@router.get("/leave-types", response_model=list[LeaveTypeOut])
def list_leave_types(_: AdminUser, db: DbSession):
    """All leave types, including inactive ones."""
    return admin_service.list_leave_types(db)


@router.post("/leave-types", response_model=LeaveTypeOut, status_code=status.HTTP_201_CREATED, responses=_E)
def create_leave_type(body: LeaveTypeCreate, admin: AdminUser, db: DbSession):
    return admin_service.create_leave_type(db, admin, body)


@router.patch("/leave-types/{leave_type_id}", response_model=LeaveTypeOut, responses=_E)
def update_leave_type(leave_type_id: int, body: LeaveTypeUpdate, admin: AdminUser, db: DbSession):
    """Changing the default allowance affects balances not yet created; set existing ones per user."""
    return admin_service.update_leave_type(db, admin, leave_type_id, body)


# ------------------------------------------------------------------ public holidays

@router.post("/holidays", response_model=HolidayOut, status_code=status.HTTP_201_CREATED, responses=_E)
def create_holiday(body: HolidayCreate, admin: AdminUser, db: DbSession):
    return admin_service.create_holiday(db, admin, body)


@router.patch("/holidays/{holiday_id}", response_model=HolidayOut, responses=_E)
def update_holiday(holiday_id: int, body: HolidayUpdate, admin: AdminUser, db: DbSession):
    return admin_service.update_holiday(db, admin, holiday_id, body)


@router.delete("/holidays/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT, responses=_E)
def delete_holiday(holiday_id: int, admin: AdminUser, db: DbSession) -> Response:
    admin_service.delete_holiday(db, admin, holiday_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ audit log

@router.get("/audit-logs", response_model=Page[AuditLogOut])
def audit_logs(
    _: AdminUser, db: DbSession,
    action: Annotated[str | None, Query(max_length=64, examples=["leave_request.approved"])] = None,
    actor_id: int | None = None,
    entity_type: Annotated[str | None, Query(max_length=50)] = None,
    entity_id: int | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
):
    """Newest first. Read-only: there is no endpoint to edit or delete audit entries."""
    rows, total = admin_service.audit_page(
        db, action=action, actor_id=actor_id, entity_type=entity_type, entity_id=entity_id,
        page=page, page_size=page_size,
    )
    return Page[AuditLogOut](
        items=[AuditLogOut.model_validate(r) for r in rows], total=total, page=page, page_size=page_size
    )
