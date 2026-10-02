"""Authentication, JWT handling, login lockout, password storage, CORS and error format."""

from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, verify_password
from app.models import UserRole
from tests.conftest import PASSWORD, auth_headers

LOGIN = "/api/v1/auth/login"


def _now():
    return datetime.now(timezone.utc)

ME = "/api/v1/auth/me"


def login(client, email, password=PASSWORD):
    return client.post(LOGIN, json={"email": email, "password": password})


class TestLogin:
    def test_valid_credentials_return_token_and_user(self, client, employee):
        r = login(client, employee.email)
        assert r.status_code == 200
        body = r.json()
        assert body["token_type"] == "bearer"
        assert body["expires_in"] == get_settings().access_token_expire_minutes * 60
        assert body["user"]["email"] == employee.email
        assert body["user"]["role"] == "employee"
        assert body["user"]["manager_name"] == "Maya Manager"

    def test_email_is_case_insensitive(self, client, employee):
        assert login(client, employee.email.upper()).status_code == 200

    def test_token_works_for_me_endpoint(self, client, employee):
        token = login(client, employee.email).json()["access_token"]
        r = client.get(ME, headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        assert r.json()["id"] == employee.id

    def test_wrong_password_and_unknown_email_get_identical_401(self, client, employee):
        wrong = login(client, employee.email, "wrong-password")
        unknown = login(client, "nobody@tawkeed.example", "wrong-password")
        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json() == unknown.json() == {"detail": "Invalid email or password", "code": "INVALID_CREDENTIALS"}

    def test_deactivated_user_cannot_log_in(self, client, make_user):
        user = make_user(UserRole.ADMIN, is_active=False)
        r = login(client, user.email)
        assert r.status_code == 401
        assert r.json()["code"] == "ACCOUNT_DISABLED"

    @pytest.mark.parametrize("body", [{}, {"email": "not-an-email", "password": "x"}, {"email": "a@tawkeed.example", "password": ""}])
    def test_invalid_body_is_422_with_field_errors(self, client, body):
        r = client.post(LOGIN, json=body)
        assert r.status_code == 422
        assert r.json()["code"] == "VALIDATION_ERROR"
        assert r.json()["errors"]

    def test_response_never_contains_password_hash(self, client, employee):
        text = login(client, employee.email).text
        assert "password" not in text.lower()
        assert employee.password_hash not in text


class TestLockout:
    def test_locks_after_max_failed_attempts(self, client, employee):
        limit = get_settings().max_failed_logins
        for _ in range(limit - 1):
            assert login(client, employee.email, "bad").status_code == 401
        r = login(client, employee.email, "bad")
        assert r.status_code == 429
        assert r.json()["code"] == "TOO_MANY_LOGIN_ATTEMPTS"
        assert int(r.headers["Retry-After"]) > 0

    def test_correct_password_is_refused_while_locked(self, client, employee):
        for _ in range(get_settings().max_failed_logins):
            login(client, employee.email, "bad")
        assert login(client, employee.email).status_code == 429

    def test_lock_expires_after_lockout_period(self, client, employee, db, monkeypatch):
        for _ in range(get_settings().max_failed_logins):
            login(client, employee.email, "bad")
        later = datetime.now(timezone.utc) + timedelta(minutes=get_settings().lockout_minutes, seconds=1)
        monkeypatch.setattr("app.core.clock.now_utc", lambda: later)
        assert login(client, employee.email).status_code == 200

    def test_successful_login_resets_failure_counter(self, client, employee, db):
        limit = get_settings().max_failed_logins
        for _ in range(limit - 1):
            login(client, employee.email, "bad")
        assert login(client, employee.email).status_code == 200
        db.refresh(employee)
        assert employee.failed_login_count == 0
        # Counter restarted: another limit-1 failures still do not lock.
        for _ in range(limit - 1):
            assert login(client, employee.email, "bad").status_code == 401


class TestTokens:
    def test_missing_token_is_401(self, client):
        r = client.get(ME)
        assert r.status_code == 401
        assert r.json()["code"] == "NOT_AUTHENTICATED"
        assert r.headers["WWW-Authenticate"] == "Bearer"

    def test_expired_token_is_401(self, client, employee):
        token = create_access_token(employee.id, "employee", expires_delta=timedelta(seconds=-5))
        r = client.get(ME, headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401
        assert r.json()["code"] == "TOKEN_EXPIRED"

    def test_token_signed_with_other_key_is_401(self, client, employee):
        forged = jwt.encode({"sub": str(employee.id), "role": "admin", "type": "access", "iat": _now(),
                             "exp": _now() + timedelta(hours=1)}, "not-the-real-secret-key-0123456789abcdef", algorithm="HS256")
        r = client.get(ME, headers={"Authorization": f"Bearer {forged}"})
        assert r.status_code == 401
        assert r.json()["code"] == "INVALID_TOKEN"

    def test_garbage_token_is_401(self, client):
        assert client.get(ME, headers={"Authorization": "Bearer abc.def.ghi"}).status_code == 401

    def test_unsigned_alg_none_token_is_rejected(self, client, employee):
        token = jwt.encode({"sub": str(employee.id), "type": "access", "iat": _now(),
                            "exp": _now() + timedelta(hours=1)}, key=None, algorithm="none")
        assert client.get(ME, headers={"Authorization": f"Bearer {token}"}).status_code == 401

    def test_token_of_deactivated_user_stops_working(self, client, employee, db):
        headers = auth_headers(employee)
        employee.is_active = False
        db.flush()
        assert client.get(ME, headers=headers).status_code == 401

    def test_role_in_token_is_not_trusted(self, client, employee):
        """Permissions come from the database, not from the token's role claim."""
        token = create_access_token(employee.id, "admin")
        assert client.get("/api/v1/admin/users", headers={"Authorization": f"Bearer {token}"}).status_code == 403


class TestPasswordStorage:
    def test_passwords_are_stored_as_bcrypt_hashes(self, employee):
        assert employee.password_hash.startswith("$2b$")
        assert PASSWORD not in employee.password_hash

    def test_hash_is_salted(self):
        assert hash_password(PASSWORD) != hash_password(PASSWORD)

    def test_verify_handles_bad_hash(self):
        assert verify_password(PASSWORD, "not-a-bcrypt-hash") is False


class TestHttpBasics:
    def test_health(self, client):
        assert client.get("/health").json() == {"status": "ok"}

    def test_cors_allows_configured_frontend(self, client):
        r = client.options(ME, headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"})
        assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"

    def test_cors_blocks_other_origins(self, client):
        r = client.options(ME, headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
        assert "access-control-allow-origin" not in r.headers

    def test_security_headers_present(self, client):
        r = client.get("/health")
        assert r.headers["X-Content-Type-Options"] == "nosniff"
        assert r.headers["X-Frame-Options"] == "DENY"

    def test_unknown_route_uses_error_shape(self, client):
        r = client.get("/api/v1/does-not-exist")
        assert r.status_code == 404
        assert r.json()["code"] == "NOT_FOUND"
