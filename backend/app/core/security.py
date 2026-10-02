from datetime import timedelta
from typing import Any

import bcrypt
import jwt

from app.core import clock
from app.core.config import get_settings

# bcrypt only uses the first 72 bytes; longer passwords are rejected by the schemas.
BCRYPT_MAX_BYTES = 72


def hash_password(password: str) -> str:
    rounds = get_settings().bcrypt_rounds
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=rounds)).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except ValueError:
        # Malformed hash or over-long password: never treat as a match.
        return False


# Used when the email is unknown, so the response takes as long as a real check
# and attackers cannot discover which emails exist by timing the login.
_DUMMY_HASH: str | None = None


def dummy_verify(password: str) -> None:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password("dummy-password-for-timing")
    verify_password(password, _DUMMY_HASH)


def create_access_token(user_id: int, role: str, expires_delta: timedelta | None = None) -> str:
    settings = get_settings()
    now = clock.now_utc()
    expire = now + (expires_delta or timedelta(minutes=settings.access_token_expire_minutes))
    payload = {"sub": str(user_id), "role": role, "type": "access", "iat": now, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key.get_secret_value(), algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    """Return the token claims, or raise jwt.PyJWTError if invalid or expired."""
    settings = get_settings()
    payload = jwt.decode(
        token,
        settings.jwt_secret_key.get_secret_value(),
        algorithms=[settings.jwt_algorithm],
        options={"require": ["sub", "exp", "iat"]},
    )
    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("Not an access token")
    return payload
