"""Demo seed: idempotent, sample requests safely in the future, isolated lockout-test account."""

from datetime import date, timedelta

import pytest
from pydantic import SecretStr
from sqlalchemy import select

from app.core.config import get_settings
from app.models import LeaveRequest, LeaveStatus, User, UserRole
from app.seed import _sample_dates, seed
from tests.conftest import FIXED_TODAY, PASSWORD

LOGIN = "/api/v1/auth/login"


@pytest.fixture
def seeded(db, monkeypatch):
    monkeypatch.setattr(get_settings(), "seed_demo_password", SecretStr(PASSWORD))
    return seed(db)


def test_creates_demo_accounts_including_lockout_test(db, seeded):
    users = {u.email: u for u in db.scalars(select(User))}
    assert {"admin@tawkeed.example", "manager@tawkeed.example", "employee1@tawkeed.example",
            "employee2@tawkeed.example", "lockout-test@tawkeed.example"} <= users.keys()
    lockout = users["lockout-test@tawkeed.example"]
    # An ordinary employee: no special privileges or exemptions.
    assert lockout.role == UserRole.EMPLOYEE
    assert lockout.manager_id == users["manager@tawkeed.example"].id


def test_sample_requests_are_weeks_in_the_future(db, seeded):
    requests = {r.status: r for r in db.scalars(select(LeaveRequest))}
    pending, approved = requests[LeaveStatus.PENDING], requests[LeaveStatus.APPROVED]
    assert pending.start_date >= FIXED_TODAY + timedelta(weeks=4)
    assert approved.start_date == pending.start_date + timedelta(weeks=1)
    assert pending.start_date.weekday() == approved.start_date.weekday() == 0  # Mondays


def test_seed_is_idempotent(db, seeded, monkeypatch):
    assert seeded  # first run created data
    assert seed(db) == []
    assert len(db.scalars(select(LeaveRequest)).all()) == 2


def test_locking_the_test_account_does_not_affect_shared_accounts(client, db, seeded):
    for _ in range(get_settings().max_failed_logins):
        client.post(LOGIN, json={"email": "lockout-test@tawkeed.example", "password": "wrong"})
    locked = client.post(LOGIN, json={"email": "lockout-test@tawkeed.example", "password": PASSWORD})
    assert locked.status_code == 429  # locked even with the correct password
    assert client.post(LOGIN, json={"email": "admin@tawkeed.example", "password": PASSWORD}).status_code == 200


@pytest.mark.parametrize("today", [date(2026, 10, 3), date(2026, 11, 27), date(2026, 12, 20), date(2027, 1, 2)])
def test_sample_dates_stay_in_one_year_and_in_the_future(today):
    pending, approved = _sample_dates(today)
    assert today < pending < approved
    assert pending.year == (approved + timedelta(days=2)).year
