from fastapi import APIRouter

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.core.security import create_access_token
from app.models import User
from app.schemas.auth import LoginRequest, TokenResponse
from app.schemas.common import ErrorResponse
from app.schemas.user import UserOut
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post(
    "/login",
    response_model=TokenResponse,
    responses={401: {"model": ErrorResponse}, 429: {"model": ErrorResponse}},
)
def login(body: LoginRequest, db: DbSession) -> TokenResponse:
    """Exchange email + password for a JWT access token.

    After repeated failures the account is temporarily locked (429 with Retry-After).
    """
    user = auth_service.authenticate(db, body.email, body.password)
    settings = get_settings()
    return TokenResponse(
        access_token=create_access_token(user.id, user.role.value),
        expires_in=settings.access_token_expire_minutes * 60,
        user=UserOut.model_validate(user),
    )


@router.get("/me", response_model=UserOut, responses={401: {"model": ErrorResponse}})
def me(user: CurrentUser) -> User:
    return user

