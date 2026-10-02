from collections.abc import Callable
from typing import Annotated

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.errors import AuthenticationError, PermissionDeniedError
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import User, UserRole

DbSession = Annotated[Session, Depends(get_db)]

_bearer = HTTPBearer(auto_error=False, description="Paste the access_token from POST /api/v1/auth/login")


def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    """Validate the bearer token and load the user fresh from the database on every request,
    so deactivation or a role change takes effect immediately."""
    if credentials is None:
        raise AuthenticationError()
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = int(payload["sub"])
    except jwt.ExpiredSignatureError:
        raise AuthenticationError("Token has expired", "TOKEN_EXPIRED") from None
    except (jwt.PyJWTError, ValueError, KeyError):
        raise AuthenticationError("Invalid token", "INVALID_TOKEN") from None

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise AuthenticationError("Invalid token", "INVALID_TOKEN")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: UserRole) -> Callable[[User], User]:
    def _check(user: CurrentUser) -> User:
        if user.role not in roles:
            raise PermissionDeniedError("You do not have permission to perform this action")
        return user

    return _check


ManagerOrAdmin = Annotated[User, Depends(require_roles(UserRole.MANAGER, UserRole.ADMIN))]
AdminUser = Annotated[User, Depends(require_roles(UserRole.ADMIN))]
