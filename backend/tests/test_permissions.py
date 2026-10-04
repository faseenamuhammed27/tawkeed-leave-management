"""Role-based access matrix: every protected endpoint x {anonymous, employee, manager, admin}.

Anonymous callers always get 401. Roles outside an endpoint's allowed set get 403.
Allowed roles may still get 404/409/422 (the ids and bodies here are dummies) but never 401/403.
"""

import pytest

from app.models import UserRole
from tests.conftest import auth_headers

EVERYONE = {"employee", "manager", "admin"}
REQUESTERS = {"employee", "manager"}  # the admin does not request leave (D2)
MANAGERS = {"manager", "admin"}
ADMINS = {"admin"}

# (method, path, roles allowed past the role check)
ENDPOINTS = [
    ("GET", "/api/v1/auth/me", EVERYONE),
    ("GET", "/api/v1/leave-types", EVERYONE),
    ("GET", "/api/v1/holidays", EVERYONE),
    ("GET", "/api/v1/me/balances", EVERYONE),
    ("GET", "/api/v1/leave-requests/preview?start_date=2026-03-09&end_date=2026-03-10", EVERYONE),
    ("GET", "/api/v1/leave-requests/mine", EVERYONE),
    ("POST", "/api/v1/leave-requests", REQUESTERS),
    ("GET", "/api/v1/leave-requests/999999", EVERYONE),
    ("POST", "/api/v1/leave-requests/999999/cancel", EVERYONE),
    ("POST", "/api/v1/leave-requests/999999/approve", MANAGERS),
    ("POST", "/api/v1/leave-requests/999999/reject", MANAGERS),
    ("GET", "/api/v1/team/members", MANAGERS),
    ("GET", "/api/v1/team/leave-requests", MANAGERS),
    ("GET", "/api/v1/team/leave-summary", MANAGERS),
    ("GET", "/api/v1/team/calendar?start_date=2026-03-01&end_date=2026-03-31", MANAGERS),
    ("GET", "/api/v1/admin/users", ADMINS),
    ("POST", "/api/v1/admin/users", ADMINS),
    ("GET", "/api/v1/admin/users/999999", ADMINS),
    ("PATCH", "/api/v1/admin/users/999999", ADMINS),
    ("GET", "/api/v1/admin/users/999999/balances", ADMINS),
    ("PUT", "/api/v1/admin/users/999999/balances", ADMINS),
    ("GET", "/api/v1/admin/leave-types", ADMINS),
    ("POST", "/api/v1/admin/leave-types", ADMINS),
    ("PATCH", "/api/v1/admin/leave-types/999999", ADMINS),
    ("POST", "/api/v1/admin/holidays", ADMINS),
    ("PATCH", "/api/v1/admin/holidays/999999", ADMINS),
    ("DELETE", "/api/v1/admin/holidays/999999", ADMINS),
    ("GET", "/api/v1/admin/audit-logs", ADMINS),
]

ROLES = {"employee": UserRole.EMPLOYEE, "manager": UserRole.MANAGER, "admin": UserRole.ADMIN}


def _ids(endpoint):
    return f"{endpoint[0]} {endpoint[1].split('?')[0]}"


@pytest.mark.parametrize("endpoint", ENDPOINTS, ids=[_ids(e) for e in ENDPOINTS])
def test_anonymous_gets_401(client, endpoint):
    method, path, _ = endpoint
    r = client.request(method, path, json={} if method in ("POST", "PUT", "PATCH") else None)
    assert r.status_code == 401, r.text


@pytest.mark.parametrize("role", list(ROLES))
@pytest.mark.parametrize("endpoint", ENDPOINTS, ids=[_ids(e) for e in ENDPOINTS])
def test_role_access(client, make_user, manager, endpoint, role):
    method, path, allowed = endpoint
    user = make_user(ROLES[role], manager=manager if role == "employee" else None)
    r = client.request(method, path, headers=auth_headers(user), json={} if method in ("POST", "PUT", "PATCH") else None)
    if role in allowed:
        assert r.status_code not in (401, 403), f"{role} should pass the role check: {r.status_code} {r.text}"
    else:
        assert r.status_code == 403, f"{role} should be forbidden: {r.status_code} {r.text}"
        assert r.json()["code"] == "FORBIDDEN"


def test_every_api_route_is_in_the_matrix():
    """Guards against adding an endpoint without a permission test."""
    from app.main import app

    public = {("POST", "/api/v1/auth/login")}
    tested = {(m, p.split("?")[0].replace("999999", "{id}")) for m, p, _ in ENDPOINTS}
    routes = set()
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/api/v1"):
            continue
        normalised = path
        for param in ("{request_id}", "{user_id}", "{leave_type_id}", "{holiday_id}"):
            normalised = normalised.replace(param, "{id}")
        for method in route.methods - {"HEAD", "OPTIONS"}:
            if (method, path) not in public:
                routes.add((method, normalised))
    assert routes - tested == set()
