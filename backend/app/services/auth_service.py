import math
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import clock
from app.core.config import get_settings
from app.core.errors import AuthenticationError, TooManyAttemptsError
from app.core.security import dummy_verify, verify_password
from app.models import User

INVALID_CREDENTIALS = "Invalid email or password"


def authenticate(db: Session, email: str, password: str) -> User:
    """Check credentials and apply the failed-login lockout.

    - Unknown email and wrong password get the same 401 message (no account discovery).
    - After MAX_FAILED_LOGINS wrong passwords the account is locked for LOCKOUT_MINUTES (429),
      and while locked even the correct password is refused.
    - A successful login resets the counter.
    """
    settings = get_settings()
    now = clock.now_utc()

    user = db.scalar(select(User).where(User.email == email.lower()).with_for_update())
    if user is None:
        dummy_verify(password)
        raise AuthenticationError(INVALID_CREDENTIALS, "INVALID_CREDENTIALS")

    if user.locked_until is not None and user.locked_until > now:
        raise _locked_error(user, now)

    if not verify_password(password, user.password_hash):
        user.failed_login_count += 1
        if user.failed_login_count >= settings.max_failed_logins:
            user.failed_login_count = 0
            user.locked_until = now + timedelta(minutes=settings.lockout_minutes)
            db.commit()
            raise _locked_error(user, now)
        db.commit()
        raise AuthenticationError(INVALID_CREDENTIALS, "INVALID_CREDENTIALS")

    if not user.is_active:
        raise AuthenticationError("This account has been deactivated", "ACCOUNT_DISABLED")

    user.failed_login_count = 0
    user.locked_until = None
    db.commit()
    return user


def _locked_error(user: User, now) -> TooManyAttemptsError:
    seconds = max(1, math.ceil((user.locked_until - now).total_seconds()))
    return TooManyAttemptsError(
        f"Too many failed login attempts. Try again in {math.ceil(seconds / 60)} minute(s).",
        extra={"retry_after_seconds": seconds},
        headers={"Retry-After": str(seconds)},
    )
