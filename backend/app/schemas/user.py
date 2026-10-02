from typing import Annotated

from pydantic import EmailStr, Field, StringConstraints, field_validator

from app.models.enums import UserRole
from app.schemas.common import APIModel, ORMModel, Password

FullName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)]


class UserOut(ORMModel):
    id: int
    email: str
    full_name: str
    role: UserRole
    manager_id: int | None
    manager_name: str | None = None
    is_active: bool


class UserBrief(ORMModel):
    id: int
    full_name: str
    email: str
    role: UserRole


class UserCreate(APIModel):
    email: EmailStr
    full_name: FullName
    password: Password
    role: UserRole
    manager_id: int | None = Field(default=None, description="Required for employees; must be a manager.")

    @field_validator("email")
    @classmethod
    def _lower(cls, v: str) -> str:
        return v.lower()


class UserUpdate(APIModel):
    """Partial update. Send manager_id: null explicitly to clear it."""

    full_name: FullName | None = None
    role: UserRole | None = None
    manager_id: int | None = None
    is_active: bool | None = None
    password: Password | None = None
