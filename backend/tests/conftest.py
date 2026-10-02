"""Shared test fixtures.

- Tests ONLY run against TEST_DATABASE_URL (a database whose name ends in "_test").
- The schema is built once per session with the real Alembic migrations.
- Every test runs inside a transaction that is rolled back, so tests never see each other's data.
- "Today" (the business date) is frozen at FIXED_TODAY so date rules are deterministic.
"""

import os
from collections.abc import Callable, Iterator
from datetime import date

import pytest
from sqlalchemy.engine import make_url

# --- Point the app at the test database BEFORE any app module creates the engine. ---
from app.core.config import Settings, get_settings

_base = Settings()
if not _base.test_database_url:
    raise RuntimeError("TEST_DATABASE_URL must be set to run the tests")
_test_db_name = make_url(_base.test_database_url).database
if not (_test_db_name or "").endswith("_test"):
    raise RuntimeError(f"Refusing to run tests against non-test database {_test_db_name!r}")

os.environ["DATABASE_URL"] = _base.test_database_url
os.environ["ENVIRONMENT"] = "test"
os.environ["BCRYPT_ROUNDS"] = "4"
os.environ["CORS_ORIGINS"] = "http://localhost:5173"
get_settings.cache_clear()

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core import clock  # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.db.session import engine, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import LeaveType, PublicHoliday, User, UserRole  # noqa: E402

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FIXED_TODAY = date(2026, 3, 2)  # a Monday
PASSWORD = "Correct-Horse-1"


@pytest.fixture(scope="session", autouse=True)
def _migrated_schema() -> Iterator[None]:
    """Build the schema from scratch with Alembic (also proves the migrations work)."""
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.downgrade(cfg, "base")
        command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def frozen_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    # Only the business date is frozen; real time is kept for JWT expiry and lockouts.
    monkeypatch.setattr(clock, "today", lambda: FIXED_TODAY)


@pytest.fixture
def db() -> Iterator[Session]:
    connection = engine.connect()
    outer = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False)
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        connection.close()


@pytest.fixture
def client(db: Session) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------- factories

_PASSWORD_HASH: str | None = None


def _password_hash() -> str:
    global _PASSWORD_HASH
    if _PASSWORD_HASH is None:
        _PASSWORD_HASH = hash_password(PASSWORD)
    return _PASSWORD_HASH


@pytest.fixture
def make_user(db: Session) -> Callable[..., User]:
    counter = {"n": 0}

    def _make(role: UserRole = UserRole.EMPLOYEE, manager: User | None = None, **kw) -> User:
        counter["n"] += 1
        user = User(
            email=kw.pop("email", f"{role.value}{counter['n']}@tawkeed.example"),
            full_name=kw.pop("full_name", f"{role.value.title()} {counter['n']}"),
            password_hash=_password_hash(),
            role=role,
            manager_id=manager.id if manager else None,
            **kw,
        )
        db.add(user)
        db.flush()
        return user

    return _make


@pytest.fixture
def admin(make_user) -> User:
    return make_user(UserRole.ADMIN, full_name="Ada Admin")


@pytest.fixture
def admin2(make_user) -> User:
    return make_user(UserRole.ADMIN, full_name="Second Admin")


@pytest.fixture
def manager(make_user) -> User:
    return make_user(UserRole.MANAGER, full_name="Maya Manager")


@pytest.fixture
def other_manager(make_user) -> User:
    return make_user(UserRole.MANAGER, full_name="Omar Othermanager")


@pytest.fixture
def employee(make_user, manager) -> User:
    return make_user(UserRole.EMPLOYEE, manager=manager, full_name="Eve Employee")


@pytest.fixture
def employee2(make_user, manager) -> User:
    return make_user(UserRole.EMPLOYEE, manager=manager, full_name="Ed Employee")


@pytest.fixture
def outsider(make_user, other_manager) -> User:
    """An employee in another manager's team."""
    return make_user(UserRole.EMPLOYEE, manager=other_manager, full_name="Olga Outsider")


@pytest.fixture
def annual(db: Session) -> LeaveType:
    lt = LeaveType(code="ANNUAL", name="Annual Leave", default_annual_days=20)
    db.add(lt)
    db.flush()
    return lt


@pytest.fixture
def sick(db: Session) -> LeaveType:
    lt = LeaveType(code="SICK", name="Sick Leave", default_annual_days=10)
    db.add(lt)
    db.flush()
    return lt


@pytest.fixture
def holiday(db: Session) -> Callable[[date, str], PublicHoliday]:
    def _make(day: date, name: str = "Holiday") -> PublicHoliday:
        h = PublicHoliday(holiday_date=day, name=name)
        db.add(h)
        db.flush()
        return h

    return _make


def auth_headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id, user.role.value)}"}
