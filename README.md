# Tawkeed Leave Management Portal

[![CI](https://github.com/faseenamuhammed27/tawkeed-leave-management/actions/workflows/ci.yml/badge.svg)](https://github.com/faseenamuhammed27/tawkeed-leave-management/actions/workflows/ci.yml)

Employees apply for leave, managers approve or reject it, and admins manage the setup.
Backend: **FastAPI · PostgreSQL 17 · SQLAlchemy 2 · Alembic · JWT**. Frontend: React + TypeScript (in progress).

| | |
|---|---|
| **Live API** | https://tawkeed-leave-api.onrender.com |
| **API docs (Swagger)** | https://tawkeed-leave-api.onrender.com/docs |
| **Health check** | https://tawkeed-leave-api.onrender.com/health |
| **CI** | [GitHub Actions](https://github.com/faseenamuhammed27/tawkeed-leave-management/actions/workflows/ci.yml): pytest + coverage gate + Docker smoke test on every push |

> The free Render plan sleeps after 15 minutes without traffic, so the first request can take about a minute to wake it up.

## Demo accounts

All demo accounts share one password, provided with the submission email (it is set through the
`SEED_DEMO_PASSWORD` environment variable and is not stored in this repository).

| Role | Email | Notes |
|---|---|---|
| Admin | `admin@tawkeed.example` | Manages users, leave types, allowances, holidays; views audit log; approves the manager's leave |
| Manager | `manager@tawkeed.example` | Manages Sara and Omar |
| Employee | `employee1@tawkeed.example` | Sara Ahmed – has a pending request for the manager to act on |
| Employee | `employee2@tawkeed.example` | Omar Farooq – has an approved request on the team calendar |

---

## Contents

1. [Architecture](#architecture)
2. [Business rules and where they are enforced](#business-rules)
3. [Run locally](#run-locally) – with Docker, or without Docker
4. [Environment variables](#environment-variables)
5. [Migrations and seed data](#migrations-and-seed-data)
6. [Tests and coverage](#tests-and-coverage)
7. [API summary](#api-summary)
8. [Security measures](#security-measures)
9. [Deployment](#deployment)
10. [Assumptions, decisions and known limitations](#assumptions-decisions-and-known-limitations)

---

## Architecture

```
React + TypeScript SPA ──HTTPS / JSON + Bearer JWT──► FastAPI (/api/v1) ──SQLAlchemy 2 + psycopg 3──► PostgreSQL 17
   (Render static site)                                (Render web service, Docker)                     (Render managed DB)
```

```
backend/
  app/
    main.py            app factory: CORS, security headers, error handlers, /health
    core/              config (env vars), security (bcrypt, JWT), clock (business date), errors
    api/               deps.py (DB session, current user, role checks) and v1 routers
    services/          ALL business rules: leave lifecycle, balances, working days, auth, admin, audit
    models/            SQLAlchemy models with database constraints as a safety net
    schemas/           Pydantic request/response models (input validation)
    seed.py            idempotent demo data
  alembic/             migrations (0001 initial schema)
  tests/               pytest suite (runs against a separate test database)
  scripts/smoke_test.py  end-to-end check of a running deployment
docker-compose.yml     local PostgreSQL + API
render.yaml            production infrastructure (Render Blueprint)
```

- **Routers are thin**; every rule lives in `app/services/`, so it exists in one place and is tested through the API.
- **The database backs up the key rules** with constraints: no overlapping pending/approved requests
  (a `btree_gist` exclusion constraint), nobody approves their own leave, end ≥ start, one calendar year,
  used days ≤ allocated, employees must have a manager and managers/admins must not.
- **Concurrency:** every write locks the employee's row (`SELECT … FOR UPDATE`) so balance and overlap
  checks cannot race when two requests arrive at once.
- **"Today"** comes from `app/core/clock.py` in the `APP_TIMEZONE` (Asia/Dubai), so date rules are testable.

### Data model

| Table | Purpose |
|---|---|
| `users` | email, name, bcrypt hash, role (`employee`/`manager`/`admin`), `manager_id`, active flag, lockout counters |
| `leave_types` | code, name, default yearly allowance, active flag |
| `leave_balances` | allocated and used days per user, leave type and year |
| `public_holidays` | date + name |
| `leave_requests` | dates, working days, status, decision and cancellation details |
| `audit_logs` | actor, action, entity, JSON details, timestamp (append-only) |

## Business rules

All rules are enforced by the API (and tested by calling it directly), not only by the UI.

| # | Rule | Implementation (`app/services/leave_service.py`) | Error |
|---|---|---|---|
| 1 | Working days only | Weekends and public holidays excluded; recalculated at approval in case a holiday was added | 400 `NO_WORKING_DAYS` |
| 2 | Sufficient balance | Submit: `days ≤ allocated − used − pending`. Approve: `used + days ≤ allocated` | 400 `INSUFFICIENT_BALANCE` |
| 3 | No overlaps | Service check + DB exclusion constraint, across all leave types | 409 `OVERLAPPING_REQUEST` |
| 4 | Valid dates | End ≥ start, start not in the past, within one calendar year | 422 |
| 5 | Balance timing | `used_days` changes only on approval (+) and on cancelling approved leave (−) | — |
| 6 | Approval rights | Employee's request → their own manager. Manager's/admin's request → an admin. Never yourself | 403 `NOT_YOUR_TEAM` / `SELF_APPROVAL_FORBIDDEN` |
| 7 | Audit trail | Create, approve, reject and cancel are written to `audit_logs` in the same transaction | — |

Error responses always look like `{"detail": "human-readable message", "code": "MACHINE_CODE"}`.

## Run locally

### Option A – Docker (recommended)

Requires Docker Desktop.

```bash
cp .env.example .env          # fill in POSTGRES_PASSWORD, JWT_SECRET_KEY, SEED_DEMO_PASSWORD
docker compose up --build
```

- API: http://localhost:8000/docs
- PostgreSQL: `localhost:5433` (5433 so it does not clash with a local PostgreSQL)
- On start the container applies migrations and seeds the demo data. Stop with `Ctrl+C`; reset with `docker compose down -v`.

### Option B – without Docker

Requires Python 3.12+ and PostgreSQL 16/17.

```bash
# 1. Databases (as a PostgreSQL superuser)
createuser --pwprompt tawkeed_app
createdb -O tawkeed_app tawkeed_leave
createdb -O tawkeed_app tawkeed_leave_test

# 2. Backend
cd backend
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env                 # fill in DATABASE_URL, TEST_DATABASE_URL, JWT_SECRET_KEY, SEED_DEMO_PASSWORD

# 3. Schema, demo data, server
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload        # http://localhost:8000/docs
```

## Environment variables

Secrets are only ever supplied through the environment. `backend/.env.example` and `.env.example`
list every variable with placeholders; real `.env` files are git-ignored.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | – | PostgreSQL URL. `postgres://` and `postgresql://` are converted to the psycopg 3 driver automatically |
| `TEST_DATABASE_URL` | tests | – | Separate database for pytest; its name must end in `_test` or the tests refuse to run |
| `JWT_SECRET_KEY` | yes | – | HMAC key for tokens, at least 32 characters (the app refuses to start otherwise) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | no | `30` | Token lifetime |
| `CORS_ORIGINS` | no | `http://localhost:5173` | Comma-separated list of allowed frontend origins |
| `APP_TIMEZONE` | no | `Asia/Dubai` | Timezone that defines "today" for leave date rules |
| `MAX_FAILED_LOGINS` / `LOCKOUT_MINUTES` | no | `5` / `15` | Failed-login lockout |
| `SEED_DEMO_PASSWORD` | seeding | – | Password for the demo accounts created by `python -m app.seed` |
| `RUN_SEED` | no | `false` | Container only: run the (idempotent) seed on start |
| `ENVIRONMENT` | no | `development` | `development`, `test` or `production` |

## Migrations and seed data

```bash
cd backend
alembic upgrade head                       # apply migrations (DATABASE_URL)
alembic -x db=test upgrade head            # same, against TEST_DATABASE_URL
alembic revision --autogenerate -m "..."   # after changing models; review the file before committing
alembic check                              # fails if models and migrations differ (also runs in CI)
python -m app.seed                         # demo data; safe to run repeatedly
```

The seed creates 1 admin, 1 manager, 2 employees reporting to the manager, three leave types
(Annual 20, Sick 10, Compassionate 5 days), sample UAE public holidays, this year's balances, and two
sample requests (one pending, one approved) created through the real service so balances and the audit
log stay consistent. In the Docker image, `docker-entrypoint.sh` runs migrations (and the seed when
`RUN_SEED=true`) before starting the server.

## Tests and coverage

```bash
cd backend
pytest --cov=app --cov-report=term-missing
```

**Result: 303 tests passing, 97% coverage** (CI fails below 70%).

- Tests use `TEST_DATABASE_URL` only, and refuse to run if that database's name does not end in `_test`.
- The schema is built once per run with the real Alembic migrations (so migrations are tested too).
- Each test runs in a transaction that is rolled back, so tests are independent.
- The business date is frozen at Monday 2026-03-02 so date rules are deterministic.

| File | Covers |
|---|---|
| `test_leave_rules.py` | One class per business rule 1–7, plus decisions D1–D5, visibility, team queue, calendar and database backstops |
| `test_permissions.py` | Every protected endpoint × {anonymous, employee, manager, admin}: 401/403 as expected; a guard test fails if a new endpoint is not in the matrix |
| `test_auth.py` | Login, identical errors for unknown email/wrong password, lockout and expiry, expired/forged/`alg=none` tokens, bcrypt storage, CORS, security headers |
| `test_admin.py` | User management with the one-manager-level rules, allowances, leave types, holidays, audit log paging/filters, audit log is read-only |
| `test_working_days.py` | Working-day counter (weekends, holidays, holiday on weekend, month boundaries), preview endpoint, balance read model |

**Deployment check:** `scripts/smoke_test.py` runs 37 end-to-end checks (login, role checks, submit →
approve → cancel, rejection, balances, calendar, audit log) against a running server:

```bash
SMOKE_PASSWORD=<demo password> python scripts/smoke_test.py https://<host>
```

Last run against production (`https://tawkeed-leave-api.onrender.com`, 3 Oct 2026): **37/37 passed**.

## API summary

Interactive documentation with request/response schemas: **`/docs`** (Swagger) and `/redoc`.
To try protected endpoints in Swagger: call `POST /api/v1/auth/login`, click **Authorize**, paste the `access_token`.

| Method & path | Who | Purpose |
|---|---|---|
| `POST /api/v1/auth/login` | public | Email + password → JWT |
| `GET /api/v1/auth/me` | any user | Current user |
| `GET /api/v1/leave-types`, `GET /api/v1/holidays?year=` | any user | Reference data |
| `GET /api/v1/me/balances?year=` | any user | Allocated, used, pending and available days per leave type |
| `GET /api/v1/leave-requests/preview?start_date=&end_date=&leave_type_id=` | any user | Live working-day count for the request form |
| `GET /api/v1/leave-requests/mine?status=` | any user | Own leave history |
| `POST /api/v1/leave-requests` | any user | Apply for leave (201) |
| `GET /api/v1/leave-requests/{id}` | owner, their manager, admin | One request |
| `POST /api/v1/leave-requests/{id}/approve` | approver | Approve (optional comment) |
| `POST /api/v1/leave-requests/{id}/reject` | approver | Reject (comment required) |
| `POST /api/v1/leave-requests/{id}/cancel` | owner / admin | Cancel (see D3) |
| `GET /api/v1/team/members`, `GET /api/v1/team/leave-requests?status=` | manager, admin | People and requests the caller approves |
| `GET /api/v1/team/calendar?start_date=&end_date=` | manager, admin | Approved leave in a date range |
| `GET/POST /api/v1/admin/users`, `GET/PATCH /api/v1/admin/users/{id}` | admin | Manage users and managers |
| `GET/PUT /api/v1/admin/users/{id}/balances` | admin | Yearly allowances |
| `GET/POST /api/v1/admin/leave-types`, `PATCH …/{id}` | admin | Leave types |
| `POST /api/v1/admin/holidays`, `PATCH/DELETE …/{id}` | admin | Public holidays |
| `GET /api/v1/admin/audit-logs` | admin | Paginated, filterable audit log |

Status codes: `200`/`201`/`204` success · `400` business rule · `401` not logged in · `403` not allowed ·
`404` not found · `409` conflict · `422` invalid input · `429` too many failed logins.

## Security measures

| Measure | Why |
|---|---|
| Passwords hashed with **bcrypt** (salted, cost 12) | Stolen database rows do not reveal passwords |
| **JWT** access tokens, HS256, **expire after 30 minutes**; signature, expiry and token type verified; `alg=none` rejected | Stateless auth with limited exposure if a token leaks |
| User **reloaded from the database on every request**; the role in the token is not trusted | Deactivation or role changes apply immediately |
| **Role checks on every protected endpoint** via FastAPI dependencies, plus object-level checks (own team, own request) in the services | Enforced server-side; a test matrix covers every endpoint × role |
| **Failed-login lockout**: 5 failures → 15-minute lock (429 + `Retry-After`), even for the right password | Slows down password guessing |
| Same 401 message and similar timing for unknown email and wrong password | Prevents discovering which accounts exist |
| **Input validation** on every field (Pydantic, unknown fields rejected, length limits); DB constraints as a backstop | Bad data is rejected early with clear 422 errors |
| **No raw SQL built from user input**: all queries go through the SQLAlchemy ORM with bound parameters | Prevents SQL injection |
| **No secrets in the repository**: everything comes from environment variables; `.env.example` files hold placeholders; Render generates the JWT key | Secrets cannot leak through Git; CI checks there are none |
| **CORS limited to the frontend's origin**; no cookies, so no CSRF surface | Other websites cannot call the API from a browser |
| Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`); HTTPS enforced by Render | Basic hardening |
| Container runs as a non-root user; production database accepts connections only from Render's private network | Limits the impact of a compromise |

## Deployment

Hosted on **Render** using the Blueprint in [`render.yaml`](render.yaml):

- **tawkeed-leave-db** – managed PostgreSQL 17, private network only.
- **tawkeed-leave-api** – the Docker image from `backend/Dockerfile`, HTTPS by default, health check on `/health`.
  Deploys automatically **only after CI passes** on `main`.
- On every start the container runs `alembic upgrade head` and the idempotent seed, then uvicorn.
- `JWT_SECRET_KEY` is generated by Render, `DATABASE_URL` is injected from the database, and
  `SEED_DEMO_PASSWORD` is entered in the Render dashboard.

To deploy your own copy: Render dashboard → **New → Blueprint** → select the repository → enter `SEED_DEMO_PASSWORD` → **Apply**.

**CI** (`.github/workflows/ci.yml`) on every push and pull request:
1. pytest against a throwaway PostgreSQL 17 service, failing below 70% coverage; `alembic check`; coverage summary on the run page.
2. Builds the Docker image, starts Docker Compose, and smoke-tests `/health`, `/docs`, login and a 403 role check.

## Assumptions, decisions and known limitations

Where the brief left details open, these decisions were made:

- **D1 – Pending requests reserve balance.** Available = allocated − used − pending. Balance is only *deducted*
  on approval (rule 5); pending requests just stop an employee from over-committing with several requests.
- **D2 – One manager level.** Employees must have a manager; managers and admins have none.
  A manager's leave is approved by an admin, an admin's leave by another admin.
- **D3 – Cancellation.** Employees can cancel their own pending leave, or approved leave before it starts.
  Admins can cancel approved leave as an administrative correction (reason required). Managers cannot cancel.
  Nothing can be cancelled once it has started. Every cancellation is audited and restores used days if it was approved.
- **D4 – Timezone.** "Today" is determined in Asia/Dubai (configurable). Weekends are Saturday and Sunday, as the brief states.
- **D5 – Whole days only**, and a request must stay within one calendar year (split year-end leave into two requests).
- Overlap rule applies across all leave types.
- Approval re-checks the actual balance and recalculates working days (holidays may have changed since submission).
  Already-approved requests are not recalculated if holidays change later.
- Pending requests whose start date has passed can still be approved or rejected, but no longer cancelled.
- Changing a leave type's default allowance applies to balances not yet created; existing ones are adjusted per user.
- Users are deactivated, never deleted, to keep the audit history intact. A manager with team members cannot be
  deactivated or demoted until the team is reassigned. Admins cannot demote or deactivate themselves.
- Viewing another person's request returns 403 (not 404).
- Managers' calendar shows their team and themselves; admins see everyone.

Known limitations:

- With a single seeded admin, an admin's own leave cannot be approved (a second admin is needed).
- The lockout is per account, so someone could deliberately lock another user out for 15 minutes.
  Per-IP rate limiting would be the next step.
- No refresh tokens: users sign in again after 30 minutes.
- Admins cannot change a user's email address.
- Seeded public holidays are illustrative, not an official calendar.
- Render free tier: the service sleeps when idle (slow first request) and the free database expires after 30 days.
