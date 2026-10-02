from typing import Annotated, Generic, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.core.security import BCRYPT_MAX_BYTES

T = TypeVar("T")


class APIModel(BaseModel):
    """Base for request bodies: unknown fields are rejected, strings are stripped."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


def _password_fits_bcrypt(value: str) -> str:
    if len(value.encode("utf-8")) > BCRYPT_MAX_BYTES:
        raise ValueError(f"Password must be at most {BCRYPT_MAX_BYTES} bytes")
    return value


Password = Annotated[str, Field(min_length=8, max_length=72), AfterValidator(_password_fits_bcrypt)]
NonEmptyStr100 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
OptionalComment = Annotated[str | None, Field(default=None, max_length=500)]
RequiredComment = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class ErrorResponse(BaseModel):
    detail: str
    code: str


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
