"""One test class per business rule in section 3 of the brief, plus decisions D1-D5.

The business date is frozen at Monday 2026-03-02 (see conftest.FIXED_TODAY).
March 2026: Mon 9 - Fri 13, Mon 16 - Fri 20, Mon 23 - Fri 27.
"""

from datetime import date

import pytest
from sqlalchemy import select

from app.models import AuditLog, LeaveBalance, LeaveRequest, LeaveStatus
from tests.conftest import auth_headers

BASE = "/api/v1/leave-requests"


def submit(client, user, leave_type, start, end, reason=None):
    body = {"leave_type_id": leave_type.id, "start_date": str(start), "end_date": str(end)}
    if reason is not None:
        body["reason"] = reason
    return client.post(BASE, json=body, headers=auth_headers(user))


def approve(client, actor, request_id, comment=None):
    body = {"comment": comment} if comment is not None else None
    return client.post(f"{BASE}/{request_id}/approve", json=body, headers=auth_headers(actor))


def reject(client, actor, request_id, comment="Not this time"):
    return client.post(f"{BASE}/{request_id}/reject", json={"comment": comment}, headers=auth_headers(actor))


def cancel(client, actor, request_id, reason=None):
    body = {"reason": reason} if reason is not None else None
    return client.post(f"{BASE}/{request_id}/cancel", json=body, headers=auth_headers(actor))


def balance(client, user, code="ANNUAL"):
    rows = client.get("/api/v1/me/balances", headers=auth_headers(user)).json()
    return next(b for b in rows if b["leave_type_code"] == code)


def set_allocation(db, user, leave_type, allocated, used=0, year=2026):
    db.add(LeaveBalance(user_id=user.id, leave_type_id=leave_type.id, year=year, allocated_days=allocated, used_days=used))
    db.flush()


def audit_rows(db, request_id, action=None):
    stmt = select(AuditLog).where(AuditLog.entity_type == "leave_request", AuditLog.entity_id == request_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    return db.scalars(stmt.order_by(AuditLog.id)).all()


@pytest.fixture
def pending(client, employee, annual):
    """A 3-day pending request (Mon 9 - Wed 11 March)."""
    r = submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 11))
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def approved(client, pending, manager):
    r = approve(client, manager, pending["id"])
    assert r.status_code == 200, r.text
    return r.json()


# ======================================================================= Rule 1

class TestRule1WorkingDaysOnly:
    def test_weekends_are_not_counted(self, client, employee, annual):
        r = submit(client, employee, annual, date(2026, 3, 13), date(2026, 3, 16))  # Fri - Mon
        assert r.status_code == 201
        assert r.json()["working_days"] == 2

    def test_public_holidays_are_not_counted(self, client, employee, annual, holiday):
        holiday(date(2026, 3, 11))
        r = submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 13))
        assert r.json()["working_days"] == 4

    def test_weekend_only_request_is_rejected(self, client, employee, annual):
        r = submit(client, employee, annual, date(2026, 3, 14), date(2026, 3, 15))
        assert r.status_code == 400
        assert r.json()["code"] == "NO_WORKING_DAYS"

    def test_holiday_only_request_is_rejected(self, client, employee, annual, holiday):
        holiday(date(2026, 3, 10))
        r = submit(client, employee, annual, date(2026, 3, 10), date(2026, 3, 10))
        assert r.status_code == 400
        assert r.json()["code"] == "NO_WORKING_DAYS"

    def test_days_are_recalculated_on_approval_if_holiday_added(self, client, manager, pending, holiday, employee):
        holiday(date(2026, 3, 10))
        r = approve(client, manager, pending["id"])
        assert r.status_code == 200
        assert r.json()["working_days"] == 2
        assert balance(client, employee)["used_days"] == 2

    def test_approval_fails_if_all_days_became_holidays(self, client, manager, employee, annual, holiday):
        req = submit(client, employee, annual, date(2026, 3, 10), date(2026, 3, 10)).json()
        holiday(date(2026, 3, 10))
        r = approve(client, manager, req["id"])
        assert r.status_code == 400
        assert r.json()["code"] == "NO_WORKING_DAYS"


# ======================================================================= Rule 2 + D1

class TestRule2SufficientBalance:
    def test_more_than_remaining_is_rejected(self, client, db, employee, annual):
        set_allocation(db, employee, annual, allocated=3)
        r = submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 12))  # 4 days
        assert r.status_code == 400
        body = r.json()
        assert body["code"] == "INSUFFICIENT_BALANCE"
        assert (body["requested_days"], body["available_days"]) == (4, 3)

    def test_exactly_remaining_is_allowed(self, client, db, employee, annual):
        set_allocation(db, employee, annual, allocated=3)
        assert submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 11)).status_code == 201

    def test_used_days_reduce_availability(self, client, db, employee, annual):
        set_allocation(db, employee, annual, allocated=5, used=4)
        assert submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 10)).status_code == 400

    def test_pending_requests_reserve_availability(self, client, db, employee, annual):
        """D1: available = allocated - used - pending, so pending requests cannot over-commit."""
        set_allocation(db, employee, annual, allocated=5)
        assert submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 11)).status_code == 201  # 3 pending
        r = submit(client, employee, annual, date(2026, 3, 16), date(2026, 3, 18))  # 3 more > 2 available
        assert r.status_code == 400
        assert r.json()["available_days"] == 2

    def test_reservation_released_when_pending_is_rejected(self, client, db, employee, manager, annual):
        set_allocation(db, employee, annual, allocated=5)
        first = submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 11)).json()
        reject(client, manager, first["id"])
        assert balance(client, employee)["available_days"] == 5
        assert submit(client, employee, annual, date(2026, 3, 16), date(2026, 3, 20)).status_code == 201

    def test_reservation_released_when_pending_is_cancelled(self, client, db, employee, annual):
        set_allocation(db, employee, annual, allocated=5)
        first = submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 11)).json()
        cancel(client, employee, first["id"])
        assert balance(client, employee)["available_days"] == 5

    def test_balance_is_per_leave_type(self, client, db, employee, annual, sick):
        set_allocation(db, employee, annual, allocated=0)
        assert submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 9)).status_code == 400
        assert submit(client, employee, sick, date(2026, 3, 9), date(2026, 3, 9)).status_code == 201

    def test_approval_rechecks_actual_balance(self, client, db, employee, manager, annual, pending):
        """If an admin lowers the allowance after submission, approval must not overdraw it."""
        # Submitting does not create a balance row, so this sets the allowance below the 3 pending days.
        set_allocation(db, employee, annual, allocated=2)
        r = approve(client, manager, pending["id"])
        assert r.status_code == 400
        assert r.json()["code"] == "INSUFFICIENT_BALANCE"

    def test_inactive_leave_type_cannot_be_requested(self, client, db, employee, annual):
        annual.is_active = False
        db.flush()
        r = submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 9))
        assert r.status_code == 400
        assert r.json()["code"] == "LEAVE_TYPE_INACTIVE"

    def test_unknown_leave_type_is_404(self, client, employee):
        r = client.post(BASE, json={"leave_type_id": 999999, "start_date": "2026-03-09", "end_date": "2026-03-09"},
                        headers=auth_headers(employee))
        assert r.status_code == 404


# ======================================================================= Rule 3

class TestRule3NoOverlaps:
    @pytest.mark.parametrize(
        ("start", "end"),
        [
            (date(2026, 3, 9), date(2026, 3, 11)),    # identical
            (date(2026, 3, 11), date(2026, 3, 13)),   # shares the last day
            (date(2026, 3, 5), date(2026, 3, 9)),     # shares the first day
            (date(2026, 3, 10), date(2026, 3, 10)),   # inside
            (date(2026, 3, 6), date(2026, 3, 16)),    # surrounds
        ],
    )
    def test_overlap_with_pending_is_rejected(self, client, employee, annual, pending, start, end):
        r = submit(client, employee, annual, start, end)
        assert r.status_code == 409
        assert r.json()["code"] == "OVERLAPPING_REQUEST"
        assert r.json()["conflicting_request_id"] == pending["id"]

    def test_overlap_with_approved_is_rejected(self, client, employee, annual, approved):
        assert submit(client, employee, annual, date(2026, 3, 10), date(2026, 3, 12)).status_code == 409

    def test_overlap_across_leave_types_is_rejected(self, client, employee, sick, pending):
        assert submit(client, employee, sick, date(2026, 3, 10), date(2026, 3, 10)).status_code == 409

    def test_adjacent_dates_are_allowed(self, client, employee, annual, pending):
        assert submit(client, employee, annual, date(2026, 3, 12), date(2026, 3, 13)).status_code == 201

    def test_overlap_with_rejected_is_allowed(self, client, employee, manager, annual, pending):
        reject(client, manager, pending["id"])
        assert submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 11)).status_code == 201

    def test_overlap_with_cancelled_is_allowed(self, client, employee, annual, pending):
        cancel(client, employee, pending["id"])
        assert submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 11)).status_code == 201

    def test_other_employees_may_take_same_dates(self, client, employee2, annual, pending):
        assert submit(client, employee2, annual, date(2026, 3, 9), date(2026, 3, 11)).status_code == 201


# ======================================================================= Rule 4 + D5

class TestRule4ValidDates:
    def test_end_before_start_is_422(self, client, employee, annual):
        r = submit(client, employee, annual, date(2026, 3, 11), date(2026, 3, 9))
        assert r.status_code == 422
        assert "end_date cannot be before start_date" in r.text

    def test_start_in_past_is_422(self, client, employee, annual):
        r = submit(client, employee, annual, date(2026, 2, 27), date(2026, 3, 3))
        assert r.status_code == 422
        assert r.json()["code"] == "START_DATE_IN_PAST"

    def test_start_today_is_allowed(self, client, employee, annual):
        assert submit(client, employee, annual, date(2026, 3, 2), date(2026, 3, 2)).status_code == 201

    def test_request_spanning_two_years_is_422(self, client, employee, annual):
        """D5: a leave request must stay within one calendar year."""
        r = submit(client, employee, annual, date(2026, 12, 30), date(2027, 1, 5))
        assert r.status_code == 422
        assert "one calendar year" in r.text

    @pytest.mark.parametrize("body", [
        {"start_date": "2026-03-09", "end_date": "2026-03-09"},                                    # missing type
        {"leave_type_id": 1, "start_date": "09/03/2026", "end_date": "2026-03-09"},                # bad format
        {"leave_type_id": 1, "start_date": "2026-03-09", "end_date": "2026-03-09", "extra": 1},    # unknown field
        {"leave_type_id": 1, "start_date": "2026-03-09", "end_date": "2026-03-09", "reason": "x" * 501},
    ])
    def test_malformed_bodies_are_422(self, client, employee, body):
        assert client.post(BASE, json=body, headers=auth_headers(employee)).status_code == 422

    def test_half_days_are_not_supported(self, client, employee, annual):
        """D5: whole days only - working_days is always an integer count of dates."""
        r = submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 9))
        assert r.json()["working_days"] == 1


# ======================================================================= Rule 5

class TestRule5BalanceTiming:
    def test_submitting_does_not_deduct(self, client, employee, pending):
        b = balance(client, employee)
        assert (b["used_days"], b["pending_days"], b["available_days"]) == (0, 3, 17)

    def test_approval_deducts(self, client, employee, approved):
        b = balance(client, employee)
        assert (b["used_days"], b["pending_days"], b["available_days"]) == (3, 0, 17)

    def test_rejection_does_not_deduct(self, client, employee, manager, pending):
        reject(client, manager, pending["id"])
        b = balance(client, employee)
        assert (b["used_days"], b["pending_days"], b["available_days"]) == (0, 0, 20)

    def test_cancelling_approved_leave_restores_balance(self, client, employee, approved):
        r = cancel(client, employee, approved["id"])
        assert r.status_code == 200
        b = balance(client, employee)
        assert (b["used_days"], b["available_days"]) == (0, 20)

    def test_cancelling_pending_does_not_touch_used_days(self, client, employee, pending):
        cancel(client, employee, pending["id"])
        assert balance(client, employee)["used_days"] == 0


# ======================================================================= Rule 6 + D2

class TestRule6ApprovalRights:
    def test_manager_can_approve_own_team(self, client, manager, pending):
        r = approve(client, manager, pending["id"], comment="Enjoy")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "approved"
        assert body["decided_by_name"] == "Maya Manager"
        assert body["decision_comment"] == "Enjoy"

    def test_manager_can_reject_own_team_with_comment(self, client, manager, pending):
        r = reject(client, manager, pending["id"], comment="Busy week")
        assert r.status_code == 200
        assert (r.json()["status"], r.json()["decision_comment"]) == ("rejected", "Busy week")

    def test_manager_cannot_act_on_other_team(self, client, other_manager, pending):
        assert approve(client, other_manager, pending["id"]).status_code == 403
        r = reject(client, other_manager, pending["id"])
        assert r.status_code == 403
        assert r.json()["code"] == "NOT_YOUR_TEAM"

    def test_employee_cannot_approve(self, client, employee2, pending):
        assert approve(client, employee2, pending["id"]).status_code == 403

    def test_employee_cannot_approve_own(self, client, employee, pending):
        assert approve(client, employee, pending["id"]).status_code == 403

    def test_admin_can_approve_any_employee_request(self, client, admin, employee, pending):
        """D2: the admin (Director) can step in on any request; rule 6 only restricts managers."""
        r = approve(client, admin, pending["id"], comment="Approved while the manager is away")
        assert r.status_code == 200
        assert (r.json()["status"], r.json()["decided_by_id"]) == ("approved", admin.id)
        assert balance(client, employee)["used_days"] == 3

    def test_admin_can_reject_any_employee_request(self, client, admin, outsider, annual):
        req = submit(client, outsider, annual, date(2026, 3, 9), date(2026, 3, 10)).json()
        r = reject(client, admin, req["id"], comment="Company event")
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"

    def test_managers_request_is_approved_by_admin(self, client, manager, admin, annual):
        req = submit(client, manager, annual, date(2026, 3, 9), date(2026, 3, 10)).json()
        assert approve(client, admin, req["id"]).status_code == 200

    def test_managers_request_is_rejected_by_admin(self, client, db, manager, admin, annual):
        req = submit(client, manager, annual, date(2026, 3, 9), date(2026, 3, 10)).json()
        r = reject(client, admin, req["id"], comment="Coverage needed that week")
        assert r.status_code == 200
        assert (r.json()["status"], r.json()["decided_by_id"]) == ("rejected", admin.id)
        assert balance(client, manager)["used_days"] == 0
        assert audit_rows(db, req["id"], "leave_request.rejected")[0].actor_id == admin.id

    def test_manager_cannot_approve_own_request(self, client, manager, annual):
        req = submit(client, manager, annual, date(2026, 3, 9), date(2026, 3, 10)).json()
        r = approve(client, manager, req["id"])
        assert r.status_code == 403
        assert r.json()["code"] == "SELF_APPROVAL_FORBIDDEN"

    def test_manager_cannot_approve_another_manager(self, client, manager, other_manager, annual):
        req = submit(client, other_manager, annual, date(2026, 3, 9), date(2026, 3, 10)).json()
        assert approve(client, manager, req["id"]).status_code == 403

    def test_admin_cannot_request_leave(self, client, db, admin, annual):
        """D2: the admin (Director) is a setup role and does not request leave."""
        r = submit(client, admin, annual, date(2026, 3, 9), date(2026, 3, 10))
        assert r.status_code == 403
        assert db.scalars(select(LeaveRequest).where(LeaveRequest.employee_id == admin.id)).all() == []

    def test_service_also_refuses_admin_leave(self, db, admin, annual):
        """Defence in depth: the service refuses even if the route check were bypassed."""
        from app.core.errors import PermissionDeniedError
        from app.schemas.leave import LeaveRequestCreate
        from app.services import leave_service

        with pytest.raises(PermissionDeniedError) as exc:
            leave_service.create_request(db, admin, LeaveRequestCreate(
                leave_type_id=annual.id, start_date=date(2026, 3, 9), end_date=date(2026, 3, 10)))
        assert exc.value.code == "ADMIN_CANNOT_REQUEST_LEAVE"

    def test_cannot_decide_twice(self, client, manager, approved):
        assert approve(client, manager, approved["id"]).status_code == 409
        r = reject(client, manager, approved["id"])
        assert r.status_code == 409
        assert r.json()["code"] == "INVALID_STATUS"

    def test_reject_requires_comment(self, client, manager, pending):
        assert reject(client, manager, pending["id"], comment="   ").status_code == 422
        r = client.post(f"{BASE}/{pending['id']}/reject", json={}, headers=auth_headers(manager))
        assert r.status_code == 422

    def test_unknown_request_is_404(self, client, manager):
        assert approve(client, manager, 999999).status_code == 404

    def test_reassigned_employee_moves_to_new_manager(self, client, db, employee, other_manager, manager, pending):
        employee.manager_id = other_manager.id
        db.flush()
        assert approve(client, manager, pending["id"]).status_code == 403
        assert approve(client, other_manager, pending["id"]).status_code == 200


# ======================================================================= Rule 7

class TestRule7AuditTrail:
    def test_approval_is_audited(self, client, db, manager, approved):
        rows = audit_rows(db, approved["id"], "leave_request.approved")
        assert len(rows) == 1
        assert rows[0].actor_id == manager.id
        assert rows[0].created_at is not None
        assert rows[0].details["new_status"] == "approved"
        assert rows[0].details["working_days"] == 3

    def test_rejection_is_audited_with_comment(self, client, db, manager, pending):
        reject(client, manager, pending["id"], comment="Busy week")
        row = audit_rows(db, pending["id"], "leave_request.rejected")[0]
        assert row.actor_id == manager.id
        assert row.details["comment"] == "Busy week"

    def test_cancellation_is_audited(self, client, db, employee, approved):
        cancel(client, employee, approved["id"], reason="Plans changed")
        row = audit_rows(db, approved["id"], "leave_request.cancelled")[0]
        assert row.actor_id == employee.id
        assert row.details["previous_status"] == "approved"
        assert row.details["balance_restored_days"] == 3
        assert row.details["reason"] == "Plans changed"

    def test_failed_action_writes_no_audit_row(self, client, db, other_manager, pending):
        approve(client, other_manager, pending["id"])
        assert audit_rows(db, pending["id"], "leave_request.approved") == []

    def test_full_history_is_kept_in_order(self, client, db, employee, approved):
        cancel(client, employee, approved["id"])
        actions = [r.action for r in audit_rows(db, approved["id"])]
        assert actions == ["leave_request.created", "leave_request.approved", "leave_request.cancelled"]


# ======================================================================= D3 cancellation

class TestCancellationRulesD3:
    def test_employee_cancels_own_pending(self, client, employee, pending):
        r = cancel(client, employee, pending["id"])
        assert r.status_code == 200
        assert (r.json()["status"], r.json()["cancelled_by_id"]) == ("cancelled", employee.id)

    def test_employee_cancels_own_approved_before_start(self, client, employee, approved):
        assert cancel(client, employee, approved["id"]).status_code == 200

    def test_employee_cannot_cancel_someone_elses_leave(self, client, employee2, pending):
        r = cancel(client, employee2, pending["id"])
        assert r.status_code == 403
        assert r.json()["code"] == "CANCEL_NOT_ALLOWED"

    def test_manager_cannot_cancel_team_approved_leave(self, client, manager, approved):
        r = cancel(client, manager, approved["id"], reason="Need you here")
        assert r.status_code == 403
        assert r.json()["code"] == "CANCEL_NOT_ALLOWED"

    def test_admin_can_cancel_approved_leave_with_reason(self, client, db, admin, employee, approved):
        r = cancel(client, admin, approved["id"], reason="Booked on wrong dates")
        assert r.status_code == 200
        body = r.json()
        assert (body["status"], body["cancelled_by_id"], body["cancellation_reason"]) == ("cancelled", admin.id, "Booked on wrong dates")
        assert balance(client, employee)["used_days"] == 0
        row = audit_rows(db, approved["id"], "leave_request.cancelled")[0]
        assert row.actor_id == admin.id
        assert row.details["administrative_correction"] is True

    def test_admin_cancellation_requires_reason(self, client, admin, approved):
        r = cancel(client, admin, approved["id"])
        assert r.status_code == 422
        assert r.json()["code"] == "CANCELLATION_REASON_REQUIRED"

    def test_admin_cannot_cancel_someone_elses_pending(self, client, admin, pending):
        r = cancel(client, admin, pending["id"], reason="x")
        assert r.status_code == 409

    def test_cannot_cancel_after_leave_started(self, client, db, employee, manager, annual, monkeypatch):
        req = submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 11)).json()
        approve(client, manager, req["id"])
        monkeypatch.setattr("app.core.clock.today", lambda: date(2026, 3, 9))  # first day of leave
        r = cancel(client, employee, req["id"])
        assert r.status_code == 409
        assert r.json()["code"] == "LEAVE_ALREADY_STARTED"

    def test_admin_cannot_cancel_after_leave_started(self, client, admin, approved, monkeypatch):
        monkeypatch.setattr("app.core.clock.today", lambda: date(2026, 3, 10))
        assert cancel(client, admin, approved["id"], reason="Correction").status_code == 409

    def test_cannot_cancel_started_pending(self, client, employee, pending, monkeypatch):
        monkeypatch.setattr("app.core.clock.today", lambda: date(2026, 3, 9))
        assert cancel(client, employee, pending["id"]).status_code == 409

    def test_cannot_cancel_rejected_or_cancelled(self, client, employee, manager, pending):
        reject(client, manager, pending["id"])
        r = cancel(client, employee, pending["id"])
        assert r.status_code == 409
        assert r.json()["code"] == "INVALID_STATUS"

    def test_unknown_request_is_404(self, client, employee):
        assert cancel(client, employee, 999999).status_code == 404


# ======================================================================= Visibility, history, team

class TestVisibilityAndLists:
    def test_history_lists_own_requests_newest_first(self, client, employee, annual, pending):
        submit(client, employee, annual, date(2026, 3, 23), date(2026, 3, 24))
        rows = client.get(f"{BASE}/mine", headers=auth_headers(employee)).json()
        assert [r["start_date"] for r in rows] == ["2026-03-23", "2026-03-09"]

    def test_history_status_filter(self, client, employee, manager, annual, pending):
        reject(client, manager, pending["id"])
        submit(client, employee, annual, date(2026, 3, 23), date(2026, 3, 24))
        rows = client.get(f"{BASE}/mine", params={"status": "rejected"}, headers=auth_headers(employee)).json()
        assert [r["status"] for r in rows] == ["rejected"]

    def test_history_does_not_include_others(self, client, employee2, pending):
        assert client.get(f"{BASE}/mine", headers=auth_headers(employee2)).json() == []

    @pytest.mark.parametrize(("who", "expected"), [
        ("employee", 200), ("manager", 200), ("admin", 200),
        ("employee2", 403), ("other_manager", 403), ("outsider", 403),
    ])
    def test_who_can_view_a_request(self, client, request, pending, admin, outsider, other_manager, employee2, who, expected):
        user = request.getfixturevalue(who)
        assert client.get(f"{BASE}/{pending['id']}", headers=auth_headers(user)).status_code == expected

    def test_get_unknown_request_is_404(self, client, employee):
        assert client.get(f"{BASE}/999999", headers=auth_headers(employee)).status_code == 404

    def test_manager_sees_only_own_team_requests(self, client, manager, outsider, annual, pending):
        submit(client, outsider, annual, date(2026, 3, 9), date(2026, 3, 10))
        rows = client.get("/api/v1/team/leave-requests", params={"status": "pending"}, headers=auth_headers(manager)).json()
        assert [r["id"] for r in rows] == [pending["id"]]

    def test_admin_queue_contains_everyone(self, client, admin, manager, outsider, annual, pending):
        mgr_req = submit(client, manager, annual, date(2026, 3, 16), date(2026, 3, 17)).json()
        out_req = submit(client, outsider, annual, date(2026, 3, 23), date(2026, 3, 24)).json()
        rows = client.get("/api/v1/team/leave-requests", headers=auth_headers(admin)).json()
        assert {r["id"] for r in rows} == {pending["id"], mgr_req["id"], out_req["id"]}
        roles = {r["id"]: r["employee_role"] for r in rows}
        assert roles[mgr_req["id"]] == "manager"
        assert roles[pending["id"]] == roles[out_req["id"]] == "employee"

    def test_team_members(self, client, manager, employee, employee2, outsider):
        names = [m["full_name"] for m in client.get("/api/v1/team/members", headers=auth_headers(manager)).json()]
        assert names == ["Ed Employee", "Eve Employee"]


class TestTeamCalendar:
    def test_shows_only_approved_team_leave_in_range(self, client, manager, employee, employee2, outsider, annual, approved):
        submit(client, employee2, annual, date(2026, 3, 10), date(2026, 3, 10))       # pending: hidden
        out = submit(client, outsider, annual, date(2026, 3, 10), date(2026, 3, 10)).json()
        r = client.get("/api/v1/team/calendar", params={"start_date": "2026-03-01", "end_date": "2026-03-31"},
                       headers=auth_headers(manager))
        assert r.status_code == 200
        entries = r.json()
        assert [e["request_id"] for e in entries] == [approved["id"]]
        assert entries[0]["employee_name"] == "Eve Employee"
        assert out["id"] not in [e["request_id"] for e in entries]

    def test_range_outside_leave_is_empty(self, client, manager, approved):
        r = client.get("/api/v1/team/calendar", params={"start_date": "2026-04-01", "end_date": "2026-04-30"},
                       headers=auth_headers(manager))
        assert r.json() == []

    def test_admin_sees_everyone(self, client, admin, approved):
        r = client.get("/api/v1/team/calendar", params={"start_date": "2026-03-01", "end_date": "2026-03-31"},
                       headers=auth_headers(admin))
        assert [e["request_id"] for e in r.json()] == [approved["id"]]

    @pytest.mark.parametrize("params", [
        {"start_date": "2026-03-31", "end_date": "2026-03-01"},
        {"start_date": "2026-01-01", "end_date": "2027-06-01"},
        {"start_date": "2026-03-01"},
    ])
    def test_invalid_range_is_422(self, client, manager, params):
        assert client.get("/api/v1/team/calendar", params=params, headers=auth_headers(manager)).status_code == 422

    def test_employee_cannot_view_team_calendar(self, client, employee):
        r = client.get("/api/v1/team/calendar", params={"start_date": "2026-03-01", "end_date": "2026-03-31"},
                       headers=auth_headers(employee))
        assert r.status_code == 403


class TestDatabaseBackstops:
    """Even if the service layer were bypassed, the database refuses invalid data."""

    def test_db_rejects_overlap(self, db, employee, annual):
        from sqlalchemy.exc import IntegrityError

        db.add(LeaveRequest(employee_id=employee.id, leave_type_id=annual.id, start_date=date(2026, 3, 9),
                            end_date=date(2026, 3, 11), working_days=3, status=LeaveStatus.PENDING))
        db.flush()
        with pytest.raises(IntegrityError, match="ex_leave_requests_no_overlap"):
            with db.begin_nested():
                db.add(LeaveRequest(employee_id=employee.id, leave_type_id=annual.id, start_date=date(2026, 3, 11),
                                    end_date=date(2026, 3, 12), working_days=2, status=LeaveStatus.PENDING))
                db.flush()

    def test_db_rejects_self_approval(self, db, employee, annual):
        from sqlalchemy.exc import IntegrityError

        from app.core import clock

        with pytest.raises(IntegrityError, match="not_self_decided"):
            with db.begin_nested():
                db.add(LeaveRequest(employee_id=employee.id, leave_type_id=annual.id, start_date=date(2026, 3, 9),
                                    end_date=date(2026, 3, 9), working_days=1, status=LeaveStatus.APPROVED,
                                    decided_by_id=employee.id, decided_at=clock.now_utc()))
                db.flush()


class TestApprovalQueueFilters:
    """GET /team/leave-requests filters (used by the dashboard widgets and the Approvals page)."""

    QUEUE = "/api/v1/team/leave-requests"

    @pytest.fixture
    def mixed(self, client, admin, manager, employee, employee2, annual, sick):
        a = submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 10)).json()     # pending, annual
        b = submit(client, employee2, sick, date(2026, 4, 6), date(2026, 4, 6)).json()       # approved, sick
        approve(client, manager, b["id"])
        c = submit(client, manager, annual, date(2026, 5, 4), date(2026, 5, 5)).json()       # rejected, manager
        reject(client, admin, c["id"], comment="Busy")
        return {"a": a["id"], "b": b["id"], "c": c["id"]}

    def ids(self, client, user, **params):
        r = client.get(self.QUEUE, params=params, headers=auth_headers(user))
        assert r.status_code == 200, r.text
        return {row["id"] for row in r.json()}

    def test_status(self, client, admin, mixed):
        assert self.ids(client, admin, status="approved") == {mixed["b"]}
        assert self.ids(client, admin, status="rejected") == {mixed["c"]}

    def test_leave_type(self, client, admin, sick, mixed):
        assert self.ids(client, admin, leave_type_id=sick.id) == {mixed["b"]}

    def test_employee(self, client, admin, employee, mixed):
        assert self.ids(client, admin, employee_id=employee.id) == {mixed["a"]}

    def test_role(self, client, admin, mixed):
        assert self.ids(client, admin, role="manager") == {mixed["c"]}
        assert self.ids(client, admin, role="employee") == {mixed["a"], mixed["b"]}

    def test_date_range_overlap(self, client, admin, mixed):
        assert self.ids(client, admin, start_date="2026-03-10", end_date="2026-04-30") == {mixed["a"], mixed["b"]}
        assert self.ids(client, admin, start_date="2026-05-05") == {mixed["c"]}

    def test_combined_filters(self, client, admin, annual, mixed):
        assert self.ids(client, admin, status="pending", leave_type_id=annual.id, role="employee") == {mixed["a"]}

    def test_manager_filters_stay_within_own_team(self, client, manager, mixed):
        # The manager's own (rejected) request and other teams never appear in their queue.
        assert self.ids(client, manager) == {mixed["a"], mixed["b"]}
        assert self.ids(client, manager, role="manager") == set()

    def test_invalid_range_is_422(self, client, admin):
        r = client.get(self.QUEUE, params={"start_date": "2026-05-01", "end_date": "2026-04-01"}, headers=auth_headers(admin))
        assert r.status_code == 422

    def test_deactivated_requester_is_marked_and_filterable(self, client, db, admin, manager, employee, employee2, mixed):
        employee.is_active = False
        db.flush()
        rows = {r["id"]: r for r in client.get(self.QUEUE, headers=auth_headers(manager)).json()}
        assert rows[mixed["a"]]["employee_is_active"] is False
        assert rows[mixed["b"]]["employee_is_active"] is True
        # Deactivated people's requests stay visible so they can still be closed.
        assert self.ids(client, manager, employee_active="false") == {mixed["a"]}
        assert self.ids(client, manager, employee_active="true") == {mixed["b"]}
        assert self.ids(client, admin, employee_active="false") == {mixed["a"]}


class TestTeamLeaveSummary:
    """GET /team/leave-summary: per-person balances and request counts per status and leave type."""

    URL = "/api/v1/team/leave-summary"

    def get(self, client, user, **params):
        r = client.get(self.URL, params=params, headers=auth_headers(user))
        assert r.status_code == 200, r.text
        return {row["full_name"]: row for row in r.json()}

    @pytest.fixture
    def activity(self, client, manager, employee, employee2, annual, sick):
        a = submit(client, employee, annual, date(2026, 3, 9), date(2026, 3, 11)).json()   # approved, 3 days
        approve(client, manager, a["id"])
        submit(client, employee, annual, date(2026, 3, 16), date(2026, 3, 17))              # pending, 2 days
        b = submit(client, employee, sick, date(2026, 3, 23), date(2026, 3, 23)).json()     # rejected
        reject(client, manager, b["id"])
        c = submit(client, employee2, annual, date(2026, 4, 6), date(2026, 4, 6)).json()    # cancelled
        cancel(client, employee2, c["id"])

    def test_counts_and_balances_per_leave_type(self, client, manager, activity):
        eve = self.get(client, manager)["Eve Employee"]
        by_type = {t["leave_type_code"]: t for t in eve["leave_types"]}
        assert (by_type["ANNUAL"]["used_days"], by_type["ANNUAL"]["pending_days"], by_type["ANNUAL"]["available_days"]) == (3, 2, 15)
        assert by_type["ANNUAL"]["requests"] == {"pending": 1, "approved": 1, "rejected": 0, "cancelled": 0}
        assert by_type["SICK"]["requests"] == {"pending": 0, "approved": 0, "rejected": 1, "cancelled": 0}
        assert eve["totals"] == {"pending": 1, "approved": 1, "rejected": 1, "cancelled": 0}
        assert self.get(client, manager)["Ed Employee"]["totals"]["cancelled"] == 1

    def test_manager_sees_only_own_team(self, client, manager, employee, employee2, outsider, activity):
        assert set(self.get(client, manager)) == {"Eve Employee", "Ed Employee"}

    def test_admin_sees_everyone_but_themselves_and_can_filter_by_role(self, client, admin, manager, outsider, other_manager, activity):
        everyone = self.get(client, admin)
        assert {"Eve Employee", "Ed Employee", "Olga Outsider", "Maya Manager", "Omar Othermanager"} <= set(everyone)
        assert "Ada Admin" not in everyone
        assert everyone["Eve Employee"]["manager_name"] == "Maya Manager"
        assert set(self.get(client, admin, role="manager")) == {"Maya Manager", "Omar Othermanager"}

    def test_search_and_year(self, client, manager, activity):
        assert set(self.get(client, manager, search="eve")) == {"Eve Employee"}
        assert self.get(client, manager, year=2027)["Eve Employee"]["totals"] == {"pending": 0, "approved": 0, "rejected": 0, "cancelled": 0}

    def test_employees_cannot_see_it(self, client, employee):
        assert client.get(self.URL, headers=auth_headers(employee)).status_code == 403
