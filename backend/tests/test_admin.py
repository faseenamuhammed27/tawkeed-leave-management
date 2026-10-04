"""Admin setup: users (D2 one manager level), allowances, leave types, holidays and the audit log."""

from datetime import date

import pytest

from app.models import LeaveBalance, UserRole
from tests.conftest import PASSWORD, auth_headers

USERS = "/api/v1/admin/users"


def create_user(client, admin, **overrides):
    body = {"email": "new.person@tawkeed.example", "full_name": "New Person", "password": "Str0ng-Passw0rd",
            "role": "employee"} | overrides
    return client.post(USERS, json=body, headers=auth_headers(admin))


class TestUserManagement:
    def test_create_employee_with_manager(self, client, admin, manager):
        r = create_user(client, admin, manager_id=manager.id)
        assert r.status_code == 201
        body = r.json()
        assert (body["role"], body["manager_id"], body["manager_name"]) == ("employee", manager.id, "Maya Manager")
        assert "password" not in r.text

    def test_created_user_can_log_in(self, client, admin, manager):
        create_user(client, admin, manager_id=manager.id, email="Mixed.Case@Tawkeed.example")
        r = client.post("/api/v1/auth/login", json={"email": "mixed.case@tawkeed.example", "password": "Str0ng-Passw0rd"})
        assert r.status_code == 200

    def test_create_manager_without_manager(self, client, admin):
        assert create_user(client, admin, role="manager", email="m@tawkeed.example").status_code == 201

    def test_second_admin_cannot_be_created(self, client, admin):
        """D2: exactly one admin account."""
        r = create_user(client, admin, role="admin", email="a2@tawkeed.example")
        assert r.status_code == 409
        assert r.json()["code"] == "ADMIN_ALREADY_EXISTS"

    def test_cannot_promote_someone_to_second_admin(self, client, admin, employee):
        r = client.patch(f"{USERS}/{employee.id}", json={"role": "admin", "manager_id": None}, headers=auth_headers(admin))
        assert r.status_code == 409
        assert r.json()["code"] == "ADMIN_ALREADY_EXISTS"

    def test_admin_can_still_edit_own_details(self, client, admin):
        r = client.patch(f"{USERS}/{admin.id}", json={"full_name": "Aisha Director"}, headers=auth_headers(admin))
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_database_rejects_a_second_admin(self, db, admin):
        from sqlalchemy.exc import IntegrityError

        from app.models import User

        with pytest.raises(IntegrityError, match="uq_users_single_admin"):
            with db.begin_nested():
                db.add(User(email="x@tawkeed.example", full_name="X", password_hash="h", role=UserRole.ADMIN))
                db.flush()

    def test_employee_requires_manager(self, client, admin):
        r = create_user(client, admin)
        assert r.status_code == 400
        assert r.json()["code"] == "MANAGER_REQUIRED"

    def test_manager_cannot_have_manager(self, client, admin, manager):
        """D2: one manager level only."""
        r = create_user(client, admin, role="manager", manager_id=manager.id)
        assert r.status_code == 400
        assert r.json()["code"] == "MANAGER_NOT_ALLOWED"

    def test_admin_cannot_have_manager(self, client, admin, manager):
        assert create_user(client, admin, role="admin", manager_id=manager.id).status_code == 400

    @pytest.mark.parametrize("target", ["employee", "admin", "missing"])
    def test_manager_must_be_a_manager(self, client, admin, employee, target):
        manager_id = {"employee": employee.id, "admin": admin.id, "missing": 999999}[target]
        r = create_user(client, admin, manager_id=manager_id)
        assert r.status_code == 400
        assert r.json()["code"] == "INVALID_MANAGER"

    def test_inactive_manager_cannot_be_assigned(self, client, admin, make_user):
        inactive = make_user(UserRole.MANAGER, is_active=False)
        assert create_user(client, admin, manager_id=inactive.id).json()["code"] == "INVALID_MANAGER"

    def test_duplicate_email_is_409(self, client, admin, employee, manager):
        r = create_user(client, admin, email=employee.email.upper(), manager_id=manager.id)
        assert r.status_code == 409
        assert r.json()["code"] == "EMAIL_TAKEN"

    @pytest.mark.parametrize("override", [
        {"email": "not-an-email"}, {"password": "short"}, {"password": "x" * 73}, {"full_name": "  "},
        {"role": "superuser"}, {"is_admin": True},
    ])
    def test_invalid_input_is_422(self, client, admin, manager, override):
        assert create_user(client, admin, manager_id=manager.id, **override).status_code == 422

    def test_list_and_filter_users(self, client, admin, manager, employee, employee2):
        all_users = client.get(USERS, headers=auth_headers(admin)).json()
        assert {u["email"] for u in all_users} >= {manager.email, employee.email, employee2.email}
        managers = client.get(USERS, params={"role": "manager"}, headers=auth_headers(admin)).json()
        assert [u["id"] for u in managers] == [manager.id]
        found = client.get(USERS, params={"search": "eve"}, headers=auth_headers(admin)).json()
        assert [u["id"] for u in found] == [employee.id]

    def test_get_user_and_404(self, client, admin, employee):
        assert client.get(f"{USERS}/{employee.id}", headers=auth_headers(admin)).json()["full_name"] == "Eve Employee"
        assert client.get(f"{USERS}/999999", headers=auth_headers(admin)).status_code == 404

    def test_reassign_employee_to_another_manager(self, client, admin, employee, other_manager):
        r = client.patch(f"{USERS}/{employee.id}", json={"manager_id": other_manager.id}, headers=auth_headers(admin))
        assert r.status_code == 200
        assert r.json()["manager_id"] == other_manager.id

    def test_promote_employee_to_manager_clears_manager(self, client, admin, employee):
        r = client.patch(f"{USERS}/{employee.id}", json={"role": "manager"}, headers=auth_headers(admin))
        assert r.status_code == 200
        assert (r.json()["role"], r.json()["manager_id"]) == ("manager", None)

    def test_demote_manager_without_team_needs_manager(self, client, admin, other_manager, manager):
        r = client.patch(f"{USERS}/{other_manager.id}", json={"role": "employee"}, headers=auth_headers(admin))
        assert r.json()["code"] == "MANAGER_REQUIRED"
        r = client.patch(f"{USERS}/{other_manager.id}", json={"role": "employee", "manager_id": manager.id},
                         headers=auth_headers(admin))
        assert r.status_code == 200

    def test_manager_with_team_cannot_be_demoted_or_deactivated(self, client, admin, manager, employee):
        for body in ({"role": "employee"}, {"is_active": False}):
            r = client.patch(f"{USERS}/{manager.id}", json=body, headers=auth_headers(admin))
            assert r.status_code == 400
            assert r.json()["code"] == "MANAGER_HAS_TEAM"

    def test_admin_cannot_demote_or_deactivate_self(self, client, admin):
        for body in ({"role": "manager"}, {"is_active": False}):
            assert client.patch(f"{USERS}/{admin.id}", json=body, headers=auth_headers(admin)).json()["code"] == "CANNOT_MODIFY_SELF"

    def test_deactivated_user_cannot_log_in(self, client, admin, employee):
        client.patch(f"{USERS}/{employee.id}", json={"is_active": False}, headers=auth_headers(admin))
        assert client.post("/api/v1/auth/login", json={"email": employee.email, "password": PASSWORD}).status_code == 401

    def test_password_reset_unlocks_account(self, client, db, admin, employee):
        for _ in range(5):
            client.post("/api/v1/auth/login", json={"email": employee.email, "password": "bad"})
        r = client.patch(f"{USERS}/{employee.id}", json={"password": "Brand-New-Pass1"}, headers=auth_headers(admin))
        assert r.status_code == 200
        assert client.post("/api/v1/auth/login", json={"email": employee.email, "password": "Brand-New-Pass1"}).status_code == 200

    def test_user_changes_are_audited_without_password(self, client, admin, employee, other_manager):
        client.patch(f"{USERS}/{employee.id}", json={"manager_id": other_manager.id, "password": "Brand-New-Pass1"},
                     headers=auth_headers(admin))
        logs = client.get("/api/v1/admin/audit-logs", params={"action": "user.updated"}, headers=auth_headers(admin)).json()
        details = logs["items"][0]["details"]
        assert details["manager_id"]["to"] == other_manager.id
        assert details["password"] == "changed"
        assert "Brand-New-Pass1" not in str(logs)


class TestAllowances:
    def test_view_and_set_allowance(self, client, admin, employee, annual):
        r = client.put(f"{USERS}/{employee.id}/balances", json={"leave_type_id": annual.id, "year": 2026, "allocated_days": 25},
                       headers=auth_headers(admin))
        assert r.status_code == 200
        assert (r.json()["allocated_days"], r.json()["available_days"]) == (25, 25)
        rows = client.get(f"{USERS}/{employee.id}/balances", params={"year": 2026}, headers=auth_headers(admin)).json()
        assert rows[0]["allocated_days"] == 25

    def test_cannot_set_below_used(self, client, db, admin, employee, annual):
        db.add(LeaveBalance(user_id=employee.id, leave_type_id=annual.id, year=2026, allocated_days=20, used_days=8))
        db.flush()
        r = client.put(f"{USERS}/{employee.id}/balances", json={"leave_type_id": annual.id, "year": 2026, "allocated_days": 5},
                       headers=auth_headers(admin))
        assert r.status_code == 400
        assert r.json()["code"] == "ALLOCATION_BELOW_USED"

    def test_unknown_user_or_type_is_404(self, client, admin, employee, annual):
        body = {"leave_type_id": annual.id, "year": 2026, "allocated_days": 5}
        assert client.put(f"{USERS}/999999/balances", json=body, headers=auth_headers(admin)).status_code == 404
        body["leave_type_id"] = 999999
        assert client.put(f"{USERS}/{employee.id}/balances", json=body, headers=auth_headers(admin)).status_code == 404

    @pytest.mark.parametrize("days", [-1, 367])
    def test_out_of_range_is_422(self, client, admin, employee, annual, days):
        r = client.put(f"{USERS}/{employee.id}/balances", json={"leave_type_id": annual.id, "year": 2026, "allocated_days": days},
                       headers=auth_headers(admin))
        assert r.status_code == 422


class TestLeaveTypes:
    def test_create_list_update(self, client, admin):
        r = client.post("/api/v1/admin/leave-types", json={"code": "study", "name": "Study Leave", "default_annual_days": 5},
                        headers=auth_headers(admin))
        assert r.status_code == 201
        assert r.json()["code"] == "STUDY"
        lt_id = r.json()["id"]
        r = client.patch(f"/api/v1/admin/leave-types/{lt_id}", json={"is_active": False, "default_annual_days": 3},
                         headers=auth_headers(admin))
        assert (r.json()["is_active"], r.json()["default_annual_days"]) == (False, 3)
        listed = client.get("/api/v1/admin/leave-types", headers=auth_headers(admin)).json()
        assert any(t["id"] == lt_id and not t["is_active"] for t in listed)

    def test_duplicates_are_409(self, client, admin, annual, sick):
        r = client.post("/api/v1/admin/leave-types", json={"code": "ANNUAL", "name": "Other", "default_annual_days": 5},
                        headers=auth_headers(admin))
        assert r.status_code == 409
        r = client.patch(f"/api/v1/admin/leave-types/{sick.id}", json={"name": "Annual Leave"}, headers=auth_headers(admin))
        assert r.status_code == 409

    @pytest.mark.parametrize("body", [
        {"code": "A", "name": "X", "default_annual_days": 1},
        {"code": "BAD CODE", "name": "X", "default_annual_days": 1},
        {"code": "OK", "name": "X", "default_annual_days": 400},
    ])
    def test_invalid_is_422(self, client, admin, body):
        assert client.post("/api/v1/admin/leave-types", json=body, headers=auth_headers(admin)).status_code == 422

    def test_update_unknown_is_404(self, client, admin):
        assert client.patch("/api/v1/admin/leave-types/999999", json={"name": "X"}, headers=auth_headers(admin)).status_code == 404


class TestHolidays:
    def test_create_update_delete(self, client, admin, employee):
        r = client.post("/api/v1/admin/holidays", json={"holiday_date": "2026-12-02", "name": "National Day"},
                        headers=auth_headers(admin))
        assert r.status_code == 201
        hid = r.json()["id"]
        r = client.patch(f"/api/v1/admin/holidays/{hid}", json={"name": "UAE National Day"}, headers=auth_headers(admin))
        assert r.json()["name"] == "UAE National Day"
        assert client.delete(f"/api/v1/admin/holidays/{hid}", headers=auth_headers(admin)).status_code == 204
        assert client.get("/api/v1/holidays", headers=auth_headers(employee)).json() == []

    def test_duplicate_date_is_409(self, client, admin, holiday):
        holiday(date(2026, 12, 2))
        r = client.post("/api/v1/admin/holidays", json={"holiday_date": "2026-12-02", "name": "Again"}, headers=auth_headers(admin))
        assert r.status_code == 409
        assert r.json()["code"] == "HOLIDAY_EXISTS"

    def test_moving_onto_existing_date_is_409(self, client, admin, holiday):
        holiday(date(2026, 12, 2))
        other = holiday(date(2026, 12, 3))
        r = client.patch(f"/api/v1/admin/holidays/{other.id}", json={"holiday_date": "2026-12-02"}, headers=auth_headers(admin))
        assert r.status_code == 409

    def test_unknown_holiday_is_404(self, client, admin):
        assert client.delete("/api/v1/admin/holidays/999999", headers=auth_headers(admin)).status_code == 404

    def test_new_holiday_changes_working_day_count(self, client, admin, employee):
        params = {"start_date": "2026-03-09", "end_date": "2026-03-13"}
        assert client.get("/api/v1/leave-requests/preview", params=params, headers=auth_headers(employee)).json()["working_days"] == 5
        client.post("/api/v1/admin/holidays", json={"holiday_date": "2026-03-10", "name": "X"}, headers=auth_headers(admin))
        assert client.get("/api/v1/leave-requests/preview", params=params, headers=auth_headers(employee)).json()["working_days"] == 4


class TestAuditLog:
    def test_audit_log_lists_leave_decisions(self, client, admin, manager, employee, annual):
        req = client.post("/api/v1/leave-requests", json={"leave_type_id": annual.id, "start_date": "2026-03-09",
                                                           "end_date": "2026-03-10"}, headers=auth_headers(employee)).json()
        client.post(f"/api/v1/leave-requests/{req['id']}/approve", headers=auth_headers(manager))
        page = client.get("/api/v1/admin/audit-logs", params={"entity_type": "leave_request", "entity_id": req["id"]},
                          headers=auth_headers(admin)).json()
        assert page["total"] == 2
        newest = page["items"][0]
        assert (newest["action"], newest["actor_id"], newest["actor_name"]) == ("leave_request.approved", manager.id, "Maya Manager")
        assert newest["created_at"]

    def test_pagination(self, client, admin, holiday):
        for day in range(1, 6):
            client.post("/api/v1/admin/holidays", json={"holiday_date": f"2026-11-0{day}", "name": f"H{day}"}, headers=auth_headers(admin))
        page = client.get("/api/v1/admin/audit-logs", params={"page": 2, "page_size": 2}, headers=auth_headers(admin)).json()
        assert (page["total"], page["page"], len(page["items"])) == (5, 2, 2)

    def test_filter_by_actor(self, client, admin, manager, employee, annual):
        client.post("/api/v1/admin/holidays", json={"holiday_date": "2026-11-02", "name": "A"}, headers=auth_headers(admin))
        req = client.post("/api/v1/leave-requests", json={"leave_type_id": annual.id, "start_date": "2026-03-09",
                                                           "end_date": "2026-03-10"}, headers=auth_headers(employee)).json()
        client.post(f"/api/v1/leave-requests/{req['id']}/approve", headers=auth_headers(manager))
        page = client.get("/api/v1/admin/audit-logs", params={"actor_id": manager.id}, headers=auth_headers(admin)).json()
        assert [i["action"] for i in page["items"]] == ["leave_request.approved"]

    def test_filter_by_date_range(self, client, db, admin):
        from datetime import datetime, timezone

        from app.models import AuditLog

        # Two entries on different days (Asia/Dubai): 1 Mar 10:00 and 3 Mar 10:00 local time.
        db.add_all([
            AuditLog(actor_id=admin.id, action="x.old", entity_type="t", entity_id=1, details={},
                     created_at=datetime(2026, 3, 1, 6, 0, tzinfo=timezone.utc)),
            AuditLog(actor_id=admin.id, action="x.new", entity_type="t", entity_id=2, details={},
                     created_at=datetime(2026, 3, 3, 6, 0, tzinfo=timezone.utc)),
        ])
        db.flush()
        get = lambda **p: [i["action"] for i in client.get("/api/v1/admin/audit-logs", params={"entity_type": "t", **p},
                                                            headers=auth_headers(admin)).json()["items"]]
        assert get(start_date="2026-03-02") == ["x.new"]
        assert get(end_date="2026-03-01") == ["x.old"]
        assert get(start_date="2026-03-01", end_date="2026-03-03") == ["x.new", "x.old"]
        assert get(start_date="2026-03-02", end_date="2026-03-02") == []

    def test_date_range_uses_business_timezone(self, client, db, admin):
        from datetime import datetime, timezone

        from app.models import AuditLog

        # 22:30 UTC on 1 Mar is already 2 Mar in Dubai (UTC+4).
        db.add(AuditLog(actor_id=admin.id, action="x.late", entity_type="tz", entity_id=1, details={},
                        created_at=datetime(2026, 3, 1, 22, 30, tzinfo=timezone.utc)))
        db.flush()
        r = client.get("/api/v1/admin/audit-logs", params={"entity_type": "tz", "start_date": "2026-03-02", "end_date": "2026-03-02"},
                       headers=auth_headers(admin)).json()
        assert [i["action"] for i in r["items"]] == ["x.late"]

    def test_invalid_date_range_is_422(self, client, admin):
        r = client.get("/api/v1/admin/audit-logs", params={"start_date": "2026-03-05", "end_date": "2026-03-01"}, headers=auth_headers(admin))
        assert r.status_code == 422

    def test_audit_log_cannot_be_modified(self, client, admin):
        for method in ("post", "put", "patch", "delete"):
            r = getattr(client, method)("/api/v1/admin/audit-logs", headers=auth_headers(admin))
            assert r.status_code == 405

    @pytest.mark.parametrize("params", [{"page": 0}, {"page_size": 101}])
    def test_invalid_paging_is_422(self, client, admin, params):
        assert client.get("/api/v1/admin/audit-logs", params=params, headers=auth_headers(admin)).status_code == 422
