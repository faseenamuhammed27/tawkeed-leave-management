"""Rule 1 (working days only) as a pure function, plus the preview endpoint and balances read model."""

from datetime import date

import pytest

from app.models import LeaveBalance, LeaveRequest, LeaveStatus
from app.services.working_days import count_working_days
from tests.conftest import auth_headers

PREVIEW = "/api/v1/leave-requests/preview"

# March 2026: Mon 2, Fri 6, Sat 7, Sun 8, Mon 9 ...


class TestCountWorkingDays:
    @pytest.mark.parametrize(
        ("start", "end", "holidays", "expected"),
        [
            (date(2026, 3, 2), date(2026, 3, 6), set(), 5),                    # Mon-Fri
            (date(2026, 3, 2), date(2026, 3, 2), set(), 1),                    # single weekday
            (date(2026, 3, 6), date(2026, 3, 9), set(), 2),                    # Fri-Mon spans a weekend
            (date(2026, 3, 7), date(2026, 3, 8), set(), 0),                    # weekend only
            (date(2026, 3, 2), date(2026, 3, 6), {date(2026, 3, 4)}, 4),       # holiday mid-week excluded
            (date(2026, 3, 2), date(2026, 3, 8), {date(2026, 3, 7)}, 5),       # holiday on Saturday not double-counted
            (date(2026, 3, 30), date(2026, 4, 3), set(), 5),                   # across month end
            (date(2026, 3, 2), date(2026, 3, 13), {date(2026, 3, 4), date(2026, 3, 10)}, 8),  # two weeks, two holidays
            (date(2026, 3, 4), date(2026, 3, 4), {date(2026, 3, 4)}, 0),       # only day is a holiday
            (date(2026, 3, 6), date(2026, 3, 2), set(), 0),                    # reversed range
        ],
    )
    def test_counts(self, start, end, holidays, expected):
        assert count_working_days(start, end, holidays) == expected


class TestPreviewEndpoint:
    def test_counts_weekends_and_holidays(self, client, employee, holiday):
        holiday(date(2026, 3, 11), "Test Day")
        r = client.get(PREVIEW, params={"start_date": "2026-03-09", "end_date": "2026-03-15"}, headers=auth_headers(employee))
        assert r.status_code == 200
        body = r.json()
        assert body["working_days"] == 4
        assert body["calendar_days"] == 7
        assert body["weekend_days"] == 2
        assert body["holidays"] == [{"date": "2026-03-11", "name": "Test Day"}]
        assert body["starts_in_past"] is False

    def test_flags_past_start(self, client, employee):
        r = client.get(PREVIEW, params={"start_date": "2026-02-27", "end_date": "2026-03-03"}, headers=auth_headers(employee))
        assert r.json()["starts_in_past"] is True

    def test_reports_balance_when_leave_type_given(self, client, employee, annual):
        r = client.get(PREVIEW, params={"start_date": "2026-03-09", "end_date": "2026-03-13", "leave_type_id": annual.id},
                       headers=auth_headers(employee))
        assert r.json()["available_days"] == 20
        assert r.json()["exceeds_balance"] is False

    def test_unknown_leave_type_is_404(self, client, employee):
        r = client.get(PREVIEW, params={"start_date": "2026-03-09", "end_date": "2026-03-13", "leave_type_id": 999999},
                       headers=auth_headers(employee))
        assert r.status_code == 404

    @pytest.mark.parametrize(
        "params",
        [
            {"start_date": "2026-03-10", "end_date": "2026-03-09"},   # end before start
            {"start_date": "2026-12-31", "end_date": "2027-01-04"},   # crosses a year (D5)
            {"start_date": "not-a-date", "end_date": "2026-03-09"},
        ],
    )
    def test_invalid_ranges_are_422(self, client, employee, params):
        assert client.get(PREVIEW, params=params, headers=auth_headers(employee)).status_code == 422

    def test_requires_login(self, client):
        assert client.get(PREVIEW, params={"start_date": "2026-03-09", "end_date": "2026-03-13"}).status_code == 401


class TestBalancesReadModel:
    def test_defaults_when_no_balance_row(self, client, employee, annual, sick):
        r = client.get("/api/v1/me/balances", headers=auth_headers(employee))
        assert r.status_code == 200
        by_code = {b["leave_type_code"]: b for b in r.json()}
        assert by_code["ANNUAL"] == {**by_code["ANNUAL"], "allocated_days": 20, "used_days": 0, "pending_days": 0, "available_days": 20, "year": 2026}
        assert by_code["SICK"]["available_days"] == 10

    def test_available_subtracts_used_and_pending(self, client, db, employee, manager, annual):
        db.add(LeaveBalance(user_id=employee.id, leave_type_id=annual.id, year=2026, allocated_days=20, used_days=5))
        db.add(LeaveRequest(employee_id=employee.id, leave_type_id=annual.id, start_date=date(2026, 4, 6),
                            end_date=date(2026, 4, 8), working_days=3, status=LeaveStatus.PENDING))
        db.flush()
        b = client.get("/api/v1/me/balances", headers=auth_headers(employee)).json()[0]
        assert (b["allocated_days"], b["used_days"], b["pending_days"], b["available_days"]) == (20, 5, 3, 12)

    def test_inactive_leave_types_are_hidden(self, client, db, employee, annual, sick):
        sick.is_active = False
        db.flush()
        codes = [b["leave_type_code"] for b in client.get("/api/v1/me/balances", headers=auth_headers(employee)).json()]
        assert codes == ["ANNUAL"]
        assert [t["code"] for t in client.get("/api/v1/leave-types", headers=auth_headers(employee)).json()] == ["ANNUAL"]

    def test_holidays_filter_by_year(self, client, employee, holiday):
        holiday(date(2026, 12, 2), "National Day")
        holiday(date(2027, 1, 1), "New Year")
        r = client.get("/api/v1/holidays", params={"year": 2027}, headers=auth_headers(employee))
        assert [h["name"] for h in r.json()] == ["New Year"]
        assert len(client.get("/api/v1/holidays", headers=auth_headers(employee)).json()) == 2

    def test_holidays_filter_by_date_range(self, client, employee, holiday):
        holiday(date(2026, 11, 30), "A")
        holiday(date(2026, 12, 2), "B")
        holiday(date(2027, 1, 1), "C")
        names = lambda **p: [h["name"] for h in client.get("/api/v1/holidays", params=p, headers=auth_headers(employee)).json()]
        assert names(start_date="2026-12-01") == ["B", "C"]
        assert names(end_date="2026-12-02") == ["A", "B"]
        assert names(start_date="2026-12-01", end_date="2026-12-31") == ["B"]
        assert names(year=2026, start_date="2026-12-01") == ["B"]          # combined with the year
        r = client.get("/api/v1/holidays", params={"start_date": "2026-12-31", "end_date": "2026-12-01"}, headers=auth_headers(employee))
        assert r.status_code == 422
