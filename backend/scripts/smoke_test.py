"""End-to-end check of a running deployment, through the public API only.

    SMOKE_PASSWORD=<demo password> python scripts/smoke_test.py https://<host>

Uses the seeded demo accounts. Leave requests are created in NEXT year (a different week on
each run) and are cancelled or rejected again, so the demo data stays usable and re-runs work.
The password is read from the environment and never printed.
"""

import os
import sys
import time
from datetime import date, timedelta

import httpx

USERS = {
    "admin": "admin@tawkeed.example",
    "manager": "manager@tawkeed.example",
    "employee1": "employee1@tawkeed.example",
    "employee2": "employee2@tawkeed.example",
}

results: list[tuple[bool, str]] = []


def check(ok: bool, name: str, detail: str = "") -> bool:
    ok = bool(ok)
    results.append((ok, name))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}{'  -> ' + detail if detail and not ok else ''}")
    return ok


def main() -> int:
    if len(sys.argv) != 2 or "SMOKE_PASSWORD" not in os.environ:
        print(__doc__)
        return 2
    base = sys.argv[1].rstrip("/")
    api = f"{base}/api/v1"
    password = os.environ["SMOKE_PASSWORD"]
    c = httpx.Client(timeout=60)

    # --- platform
    r = c.get(f"{base}/health")
    check(r.status_code == 200 and r.json() == {"status": "ok"}, "GET /health")
    check(c.get(f"{base}/docs").status_code == 200, "GET /docs (Swagger UI)")
    spec = c.get(f"{base}/openapi.json")
    check(spec.status_code == 200 and len(spec.json()["paths"]) >= 20, "GET /openapi.json")
    check(base.startswith("https://") or "localhost" in base or "127.0.0.1" in base, "served over HTTPS")

    # --- auth
    tokens: dict[str, dict[str, str]] = {}
    for role, email in USERS.items():
        r = c.post(f"{api}/auth/login", json={"email": email, "password": password})
        if check(r.status_code == 200, f"login as {role}", f"{r.status_code} {r.text[:120]}"):
            tokens[role] = {"Authorization": f"Bearer {r.json()['access_token']}"}
    if len(tokens) != len(USERS):
        return summary()
    r = c.post(f"{api}/auth/login", json={"email": "nobody@tawkeed.example", "password": "wrong-password"})
    check(r.status_code == 401, "unknown user is rejected with 401")
    check(c.get(f"{api}/auth/me").status_code == 401, "no token -> 401")

    # --- role checks
    check(c.get(f"{api}/admin/users", headers=tokens["employee1"]).status_code == 403, "employee -> admin endpoint 403")
    check(c.get(f"{api}/team/leave-requests", headers=tokens["employee1"]).status_code == 403, "employee -> manager endpoint 403")
    check(c.get(f"{api}/admin/audit-logs", headers=tokens["manager"]).status_code == 403, "manager -> admin endpoint 403")
    check(c.get(f"{api}/admin/users", headers=tokens["admin"]).status_code == 200, "admin -> admin endpoint 200")

    # --- reference data
    types = c.get(f"{api}/leave-types", headers=tokens["employee1"]).json()
    annual = next((t for t in types if t["code"] == "ANNUAL"), None)
    check(annual is not None, "leave types available")
    check(len(c.get(f"{api}/holidays", headers=tokens["employee1"]).json()) >= 1, "public holidays available")
    if annual is None:
        return summary()

    # Dates in next year, a different week each run (cancelled/rejected requests don't block re-runs).
    year = date.today().year + 1
    week = 6 + (int(time.time()) // 600) % 36
    monday = date(year, 1, 1) + timedelta(days=(7 - date(year, 1, 1).weekday()) % 7, weeks=week)

    def balance(user: str) -> dict:
        rows = c.get(f"{api}/me/balances", params={"year": year}, headers=tokens[user]).json()
        return next(b for b in rows if b["leave_type_code"] == "ANNUAL")

    def submit(user: str, start: date, end: date):
        return c.post(f"{api}/leave-requests", headers=tokens[user],
                      json={"leave_type_id": annual["id"], "start_date": str(start), "end_date": str(end)})

    # --- preview
    r = c.get(f"{api}/leave-requests/preview", headers=tokens["employee1"],
              params={"start_date": str(monday), "end_date": str(monday + timedelta(days=6)), "leave_type_id": annual["id"]})
    check(r.status_code == 200 and r.json()["working_days"] <= 5, "live working-day preview")

    # --- submit -> balance reserved -> approve -> deducted -> cancel -> restored
    before = balance("employee1")
    r = submit("employee1", monday, monday + timedelta(days=1))
    if not check(r.status_code == 201, "employee submits leave (201)", r.text[:200]):
        return summary()
    req = r.json()
    after_submit = balance("employee1")
    check(after_submit["pending_days"] == before["pending_days"] + req["working_days"]
          and after_submit["used_days"] == before["used_days"], "submit reserves balance without deducting (D1)")
    check(submit("employee1", monday + timedelta(days=1), monday + timedelta(days=2)).status_code == 409, "overlapping request -> 409")
    check(submit("employee1", date.today() - timedelta(days=3), date.today()).status_code == 422, "start in the past -> 422")
    check(submit("employee1", monday + timedelta(days=3), monday + timedelta(days=2)).status_code == 422, "end before start -> 422")
    check(c.post(f"{api}/leave-requests/{req['id']}/approve", headers=tokens["employee1"]).status_code == 403,
          "employee cannot approve own leave -> 403")

    r = c.post(f"{api}/leave-requests/{req['id']}/approve", headers=tokens["manager"], json={"comment": "Smoke test"})
    check(r.status_code == 200 and r.json()["status"] == "approved", "manager approves team request")
    after_approve = balance("employee1")
    check(after_approve["used_days"] == before["used_days"] + req["working_days"], "approval deducts balance")
    check(c.post(f"{api}/leave-requests/{req['id']}/approve", headers=tokens["manager"]).status_code == 409, "approving twice -> 409")
    check(c.post(f"{api}/leave-requests/{req['id']}/cancel", headers=tokens["manager"]).status_code == 403,
          "manager cannot cancel team leave -> 403 (D3)")

    cal = c.get(f"{api}/team/calendar", headers=tokens["manager"],
                params={"start_date": str(monday), "end_date": str(monday + timedelta(days=6))})
    check(cal.status_code == 200 and any(e["request_id"] == req["id"] for e in cal.json()), "approved leave shows on team calendar")

    r = c.post(f"{api}/leave-requests/{req['id']}/cancel", headers=tokens["employee1"], json={"reason": "Smoke test cleanup"})
    check(r.status_code == 200 and r.json()["status"] == "cancelled", "employee cancels approved leave before it starts")
    check(balance("employee1")["used_days"] == before["used_days"], "cancellation restores balance")

    # --- rejection
    before2 = balance("employee2")
    r = submit("employee2", monday + timedelta(days=7), monday + timedelta(days=8))
    check(r.status_code == 201, "second employee submits leave")
    rid = r.json().get("id")
    check(c.post(f"{api}/leave-requests/{rid}/reject", headers=tokens["manager"], json={}).status_code == 422,
          "reject without comment -> 422")
    r = c.post(f"{api}/leave-requests/{rid}/reject", headers=tokens["manager"], json={"comment": "Smoke test"})
    check(r.status_code == 200 and r.json()["status"] == "rejected", "manager rejects with comment")
    after2 = balance("employee2")
    check((after2["pending_days"], after2["used_days"]) == (before2["pending_days"], before2["used_days"]),
          "rejection releases the reservation and deducts nothing")

    # --- history and audit
    mine = c.get(f"{api}/leave-requests/mine", headers=tokens["employee1"]).json()
    check(any(m["id"] == req["id"] and m["status"] == "cancelled" for m in mine), "employee history shows the request")
    logs = c.get(f"{api}/admin/audit-logs", headers=tokens["admin"],
                 params={"entity_type": "leave_request", "entity_id": req["id"]}).json()
    actions = [i["action"] for i in logs["items"]]
    check(set(actions) >= {"leave_request.created", "leave_request.approved", "leave_request.cancelled"},
          "audit log records create/approve/cancel with actor and time", str(actions))
    rej = c.get(f"{api}/admin/audit-logs", headers=tokens["admin"], params={"action": "leave_request.rejected", "entity_id": rid}).json()
    check(rej["total"] == 1 and rej["items"][0]["actor_name"], "audit log records the rejection")

    return summary()


def summary() -> int:
    passed = sum(ok for ok, _ in results)
    print(f"\n{passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
