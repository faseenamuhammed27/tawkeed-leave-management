# Tawkeed Leave Management Portal

[![CI](https://github.com/faseenamuhammed27/tawkeed-leave-management/actions/workflows/ci.yml/badge.svg)](https://github.com/faseenamuhammed27/tawkeed-leave-management/actions/workflows/ci.yml)

Employees apply for leave, managers approve or reject it, and admins manage the setup.
Backend: **FastAPI · PostgreSQL 17 · SQLAlchemy 2 · Alembic · JWT**. Frontend: **React 19 · TypeScript · Vite · TanStack Query**.

| | |
|---|---|
| **Live app** | https://tawkeed-leave-web.onrender.com |
| **Live API (base URL)** | `https://tawkeed-leave-api.onrender.com/api/v1` – browse it through the Swagger docs below |
| **API docs (Swagger)** | https://tawkeed-leave-api.onrender.com/docs |
| **Health check** | https://tawkeed-leave-api.onrender.com/health |
| **CI** | [GitHub Actions](https://github.com/faseenamuhammed27/tawkeed-leave-management/actions/workflows/ci.yml): backend pytest + coverage gate, frontend typecheck + Vitest + build, Docker + Playwright end-to-end tests on every push |

> The free Render plan sleeps after 15 minutes without traffic, so the first request can take about a minute to wake it up.

## Demo accounts

All demo accounts share one password, provided with the submission email (it is set through the
`SEED_DEMO_PASSWORD` environment variable and is not stored in this repository).

| Role | Email | Name and what to look at |
|---|---|---|
| Admin (Director) | `admin@tawkeed.example` | Aisha Al Mansouri – company setup, all approvals, team overview, audit log. Does not request leave |
| Manager | `manager@tawkeed.example` | Khalid Rahman – team: Sara, Omar (and the lockout-test account). His own leave (7–8 Dec) was approved by the admin |
| Manager | `manager2@tawkeed.example` | Fatima Hassan – team: Yusuf, Layla, Rahul, Noor. Has Rahul's and Noor's pending requests to review |
| Employee | `employee1@tawkeed.example` | Sara Ahmed – pending request (2–3 Nov) for Khalid to act on |
| Employee | `employee2@tawkeed.example` | Omar Farooq – approved leave (9–11 Nov) on the team calendar; a rejected request (21–22 Dec) |
| Employee | `employee3@tawkeed.example` | Yusuf Khan – approved leave (19–21 Oct); a request cancelled by the admin as a correction |
| Employee | `employee4@tawkeed.example` | Layla Nasser – a rejected request (26–27 Oct) and one she cancelled after approval |
| Employee | `employee5@tawkeed.example` | Rahul Menon – pending request (16–20 Nov) for Fatima |
| Employee | `employee6@tawkeed.example` | Noor Saleh – **deactivated** (cannot sign in); her pending request shows the Deactivated badge |
| Employee | `lockout-test@tawkeed.example` | **For trying the failed-login lockout** – see below |

The production demo covers every request status: pending, approved, rejected, cancelled by the employee and
cancelled by the admin. The extra people and requests were added through the live app (so they follow the same
rules and appear in the audit log); the seed script creates the core accounts and two sample requests.

**Testing the login lockout:** please use `lockout-test@tawkeed.example` rather than the shared accounts.
After 5 wrong passwords that account is locked for 15 minutes (HTTP 429, even with the correct password),
while every other account keeps working. It is an ordinary employee account: the lockout rules are the same
for all users, and nothing in the authentication code treats it differently.

---

## Contents

1. [Architecture](#architecture)
2. [Business rules and where they are enforced](#business-rules)
3. [Run locally](#run-locally) – with Docker, or without Docker, plus the frontend
4. [Environment variables](#environment-variables)
5. [Migrations and seed data](#migrations-and-seed-data)
6. [Tests and coverage](#tests-and-coverage)
7. [API summary](#api-summary)
8. [Security measures](#security-measures)
9. [Deployment](#deployment)
10. [What We Chose Not to Implement](#what-we-chose-not-to-implement)
11. [Assumptions, decisions and known limitations](#assumptions-decisions-and-known-limitations)

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
  alembic/             migrations (0001 initial schema, 0002 single admin)
  tests/               pytest suite (runs against a separate test database)
  scripts/smoke_test.py  end-to-end check of a running deployment
frontend/
  src/api/             typed API client (base URL from VITE_API_BASE_URL) and endpoint functions
  src/auth/            session handling: JWT + expiry, automatic sign-out on expiry or 401
  src/components/      layout and role-based navigation, route guards, shared UI (alerts, modal, tables)
  src/pages/           dashboard, apply, history, approvals, calendar, admin/* screens
  src/lib/dates.ts     date formatting and calendar grid (no business rules)
  e2e/                 Playwright end-to-end tests
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
| 6 | Approval rights | Managers act only on their own team's requests. The admin (Director) can act on any request; managers' requests go to the admin. Never yourself | 403 `NOT_YOUR_TEAM` / `SELF_APPROVAL_FORBIDDEN` | 403 `NOT_YOUR_TEAM` / `SELF_APPROVAL_FORBIDDEN` |
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

### Frontend

Requires Node.js 20.19+ (22 recommended) and a running API (either option above).

```bash
cd frontend
cp .env.example .env          # VITE_API_BASE_URL=http://localhost:8000
npm install
npm run dev                   # http://localhost:5173
```

The API's `CORS_ORIGINS` must include the frontend's address (`http://localhost:5173` by default).

| Screen | Who | What it does |
|---|---|---|
| Dashboard | everyone | Employees and managers: balance cards (allocated, used, pending, available), recent requests, holidays, pending approvals. Admin: manager and employee counts, and Pending / Approved / Rejected widgets broken down by leave type for **this month or this year**; each widget opens the filtered list |
| Apply for leave | employee, manager | Date pickers with a **live working-day count** from the API (`/leave-requests/preview`), holidays in range, balance warning; API errors shown in the form |
| My requests | employee, manager | History with status, leave type and date filters; cancel own pending leave, or approved leave before it starts |
| Approvals | manager, admin | Queue with filters for status, leave type, person, date range (and role, for the admin), kept in the URL; an **Active** / **Deactivated** badge next to each name and a matching filter for both managers and the admin; the admin also sees each requester's role; approve (optional comment) or reject (**comment required**) |
| Team members | manager, admin | One row per person: days left / used / pending and request counts per status for each leave type, yearly totals, link to their requests; filters for name, leave type, year (and role, for the admin, who also sees each person's role and manager) |
| Team calendar | manager, admin | Month view of approved leave with weekends and holidays marked; admins can cancel approved leave as a correction (reason required) |
| Users & managers, Allowances, Leave types, Public holidays, Audit log | admin | Everything the admin API offers |

The frontend never re-implements business rules: working days, balances, overlaps, permissions and
cancellation rules all come from the API, which stays the source of truth. Menu items and pages are hidden
by role for convenience only; every call is still authorised by the backend.

## Environment variables

Secrets are only ever supplied through the environment. `backend/.env.example`, `frontend/.env.example`
and the root `.env.example` (for Docker Compose) list every variable with placeholders; real `.env` files are git-ignored.

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
| `VITE_API_BASE_URL` | frontend | `http://localhost:8000` | API address compiled into the frontend bundle (public, not a secret) |

## Migrations and seed data

```bash
cd backend
alembic upgrade head                       # apply migrations (DATABASE_URL)
alembic -x db=test upgrade head            # same, against TEST_DATABASE_URL
alembic revision --autogenerate -m "..."   # after changing models; review the file before committing
alembic check                              # fails if models and migrations differ (also runs in CI)
python -m app.seed                         # demo data; safe to run repeatedly
```

The seed creates 1 admin, 1 manager, 2 employees reporting to the manager, a `lockout-test` employee
account, three leave types (Annual 20, Sick 10, Compassionate 5 days), sample UAE public holidays, this
year's balances, and two sample requests (one pending, one approved) created through the real service so
balances and the audit log stay consistent. The samples start about five weeks after seeding, so they are
still in the future while the demo is reviewed. In the Docker image, `docker-entrypoint.sh` runs migrations (and the seed when
`RUN_SEED=true`) before starting the server.

## Tests and coverage

### Test report

| Suite | Tool | Tests | Result |
|---|---|---|---|
| Backend: business rules, permissions, auth/security, admin, seed | pytest + coverage | 341 | all passing, **97.6% line coverage** (CI gate: 70%) |
| Frontend: components, API client, role-based UI | Vitest + Testing Library | 64 | all passing |
| End-to-end: full employee → manager → admin workflow in a real browser | Playwright | 3 | all passing (CI, local, and once against the live site) |
| Deployment smoke test against a running API | `scripts/smoke_test.py` | 37 checks | all passing |

All suites run on every push in [GitHub Actions](https://github.com/faseenamuhammed27/tawkeed-leave-management/actions/workflows/ci.yml).

### Backend tests

```bash
cd backend
pytest --cov=app --cov-report=term-missing
```

- Tests use `TEST_DATABASE_URL` only, and refuse to run if that database's name does not end in `_test`.
- The schema is built once per run with the real Alembic migrations (so migrations are tested too).
- Each test runs in a transaction that is rolled back, so tests are independent.
- The business date is frozen at Monday 2026-03-02 so date rules are deterministic.

| File | Covers |
|---|---|
| `test_leave_rules.py` | One class per business rule 1–7, plus decisions D1–D5, visibility, team queue and its filters, team leave summary, calendar and database backstops |
| `test_permissions.py` | Every protected endpoint × {anonymous, employee, manager, admin}: 401/403 as expected; a guard test fails if a new endpoint is not in the matrix |
| `test_auth.py` | Login, identical errors for unknown email/wrong password, lockout and expiry, expired/forged/`alg=none` tokens, bcrypt storage, CORS, security headers |
| `test_admin.py` | User management with the one-manager-level rules, single admin (API and database), allowances, leave types, holidays, audit log paging/filters, audit log is read-only |
| `test_seed.py` | Seed is idempotent, sample requests are weeks in the future and stay within one year, locking the lockout-test account leaves the shared accounts working |
| `test_working_days.py` | Working-day counter (weekends, holidays, holiday on weekend, month boundaries), preview endpoint, balance read model |

### Frontend tests

```bash
cd frontend
npm test                      # Vitest + Testing Library (64 tests)
npm run typecheck
E2E_PASSWORD=<demo password> npm run e2e   # Playwright; needs the API and `npm run preview -- --port 5173` running
```

| File | Covers |
|---|---|
| `src/api/client.test.ts` | Bearer token, API error shape → readable messages, field validation errors, sign-out on 401, network errors |
| `src/components/Layout.test.tsx` | Menu per role (no leave menu for the admin), sign-out confirmation (Cancel keeps the session), route guards (signed out → login, wrong role → "no access") |
| `src/pages/DashboardPage.test.tsx` | Employee dashboard with balance cards; admin widgets by status and leave type, links to filtered lists, month/year switch, no personal balances |
| `src/pages/LoginPage.test.tsx` | Required fields, wrong password and lockout messages from the API, successful sign-in |
| `src/pages/ApplyLeavePage.test.tsx` | Live working-day count from the API, balance warning, end-before-start, required fields, API refusal shown, successful submit |
| `src/pages/ApprovalsPage.test.tsx` | Queue, empty state, **reject disabled until a comment is entered**, approve, API refusal shown, filters read from the URL and sent to the API, no role filter for managers |
| `src/pages/HistoryPage.test.tsx` | Leave type and date filters, status and decision details, cancel only where allowed, cancel flow, API refusal, empty and error states |
| `src/pages/TeamMembersPage.test.tsx` | Balance and status counts per leave type, role/manager columns and role filter for the admin only, leave type filter, empty state |
| `src/pages/admin/AuditLogPage.test.tsx` | Who and date-range filters sent to the API, Clear filters, empty state |
| `src/pages/admin/HolidaysPage.test.tsx` | Year and date-range filters sent to the API, Clear filters, filtered empty state |
| `src/lib/dates.test.ts` | Asia/Dubai "today", month grid, date ranges |
| `e2e/leave-workflow.spec.ts` | Real browser against the real API: employee applies (live count, overlap refused, admin pages blocked) → manager approves one and rejects one with a comment → calendar shows the approved leave → employee sees the decisions and cancels → admin screens and audit log. Also runs the login error on a mobile viewport |

CI runs the Playwright suite against the Docker Compose stack on every push.

**Deployment check:** `scripts/smoke_test.py` runs 37 end-to-end checks (login, role checks, submit →
approve → cancel, rejection, balances, calendar, audit log) against a running server:

```bash
SMOKE_PASSWORD=<demo password> python scripts/smoke_test.py http://localhost:8000
```

It creates (and then cancels or rejects) real leave requests, so point it at a local or staging server.
Before the demo data was finalised it was run against production on 3 Oct 2026 (**37/37 passed**), together
with the Playwright suite against the live site (**3/3 passed**); the production database was then reset and
re-seeded so reviewers start from clean demo data.

## API summary

Interactive documentation with request/response schemas: **`/docs`** (Swagger) and `/redoc`.
To try protected endpoints in Swagger: call `POST /api/v1/auth/login`, click **Authorize**, paste the `access_token`.

| Method & path | Who | Purpose |
|---|---|---|
| `POST /api/v1/auth/login` | public | Email + password → JWT |
| `GET /api/v1/auth/me` | any user | Current user |
| `GET /api/v1/leave-types`, `GET /api/v1/holidays?year=&start_date=&end_date=` | any user | Reference data (holidays filterable by year and date range) |
| `GET /api/v1/me/balances?year=` | any user | Allocated, used, pending and available days per leave type |
| `GET /api/v1/leave-requests/preview?start_date=&end_date=&leave_type_id=` | any user | Live working-day count for the request form |
| `GET /api/v1/leave-requests/mine?status=&leave_type_id=&start_date=&end_date=` | any user | Own leave history, filterable by status, leave type and date range |
| `POST /api/v1/leave-requests` | employee, manager | Apply for leave (201); the admin gets 403 (D2) |
| `GET /api/v1/leave-requests/{id}` | owner, their manager, admin | One request |
| `POST /api/v1/leave-requests/{id}/approve` | the employee's manager, or the admin | Approve (optional comment) |
| `POST /api/v1/leave-requests/{id}/reject` | the employee's manager, or the admin | Reject (comment required) |
| `POST /api/v1/leave-requests/{id}/cancel` | owner / admin | Cancel (see D3) |
| `GET /api/v1/team/members` | manager, admin | People whose requests the caller can decide on |
| `GET /api/v1/team/leave-requests?status=&leave_type_id=&employee_id=&role=&employee_active=&start_date=&end_date=` | manager, admin | Requests the caller can decide on (a manager's team; everyone for the admin), with filters; each row includes the requester's role and whether they are active |
| `GET /api/v1/team/leave-summary?year=&role=&search=` | manager, admin | Per person: balance per leave type and request counts per status (a manager's team; everyone for the admin) |
| `GET /api/v1/team/calendar?start_date=&end_date=` | manager, admin | Approved leave in a date range |
| `GET/POST /api/v1/admin/users`, `GET/PATCH /api/v1/admin/users/{id}` | admin | Manage users and managers (only one admin account: 409 for a second) |
| `GET/PUT /api/v1/admin/users/{id}/balances` | admin | Yearly allowances |
| `GET/POST /api/v1/admin/leave-types`, `PATCH …/{id}` | admin | Leave types |
| `POST /api/v1/admin/holidays`, `PATCH/DELETE …/{id}` | admin | Public holidays |
| `GET /api/v1/admin/audit-logs?action=&actor_id=&start_date=&end_date=&page=` | admin | Paginated audit log, filterable by action, who and date range (days in the business timezone) |

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
| **No secrets in the repository**: everything comes from environment variables; `.env` files are git-ignored and `.env.example` files hold placeholders; Render generates the JWT key; CI uses throwaway, per-run secrets | Secrets cannot leak through Git |
| **CORS limited to the frontend's origin**; no cookies, so no CSRF surface | Other websites cannot call the API from a browser |
| Access token kept in the browser's **`localStorage`**, valid for **30 minutes**, removed on sign-out, on expiry and on any 401 | Simple and survives a page refresh. The trade-off: a script injected into the page (XSS) could read it. This is mitigated by React's automatic output escaping, no use of raw HTML injection, **no third-party scripts** (the bundle is first-party code only), and the short expiry. An HttpOnly cookie would hide the token from scripts but would need CSRF protection; that is the next step for a production system |
| Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`); HTTPS enforced by Render | Basic hardening |
| Container runs as a non-root user; production database connections require the long, Render-generated password and are encrypted with SSL | Limits the impact of a compromise and protects data in transit |

## Deployment

Hosted on **Render** using the Blueprint in [`render.yaml`](render.yaml):

- **tawkeed-leave-db** – managed PostgreSQL 17. External access is controlled by Render's access-control list;
  connections also require the Render-generated password and SSL. The API connects over Render's internal network.
- **tawkeed-leave-web** – the React app as a static site (`npm ci && npm run build`), with SPA rewrites and security headers.
  `VITE_API_BASE_URL` points it at the API; the API's `CORS_ORIGINS` allows only this address.
- **tawkeed-leave-api** – the Docker image from `backend/Dockerfile`, HTTPS by default, health check on `/health`.
  Deploys automatically **only after CI passes** on `main`.
- On every start the container runs `alembic upgrade head` and the idempotent seed, then uvicorn.
- `JWT_SECRET_KEY` is generated by Render, `DATABASE_URL` is injected from the database, and
  `SEED_DEMO_PASSWORD` is entered in the Render dashboard.

To deploy your own copy: Render dashboard → **New → Blueprint** → select the repository → enter `SEED_DEMO_PASSWORD` → **Apply**.

**CI** (`.github/workflows/ci.yml`) on every push and pull request:
1. pytest against a throwaway PostgreSQL 17 service, failing below 70% coverage; `alembic check`; coverage summary on the run page.
2. Frontend: typecheck, Vitest and a production build.
3. Builds the Docker image, starts Docker Compose, smoke-tests `/health`, `/docs`, login and a 403 role check,
   then builds the frontend and runs the Playwright end-to-end tests against that stack.

## What We Chose Not to Implement

The brief asks to prioritise working business rules, tests and a live deployment. These were left out
deliberately to keep the scope focused; each would be a natural next step.

| Not implemented | Why |
|---|---|
| Email or in-app notifications | Not required by the brief; managers see pending requests on their dashboard and Approvals page instead |
| Half-day and hourly leave | Whole days keep the working-day and balance rules unambiguous (decision D5) |
| Requests spanning two calendar years | Balances are yearly; splitting year-end leave into two requests keeps each balance correct (D5) |
| Carry-over of unused days and accrual during the year | Allowances are set per year by an admin; carry-over policies vary by company |
| Multi-level approval chains and multiple admins | One manager level and a single admin were chosen (D2); managers' leave goes to the admin |
| Refresh tokens and HttpOnly-cookie sessions | Short-lived (30-minute) access tokens keep the auth flow simple; users sign in again after expiry |
| Per-IP rate limiting | The required failed-login limit is implemented per account; IP-based limiting is better handled by a gateway or proxy in production |
| Self-service password reset and email changes | Needs an email service; admins can reset passwords |
| Frontend container in Docker Compose | The frontend is a static build served by Render's CDN; Compose covers the API and database, which is where the runtime dependencies are |
| File attachments (e.g. medical certificates) | Not in the brief; would need file storage and retention rules |
| Pagination beyond the audit log | The audit log grows without limit and is paginated server-side (25 per page, max 100). Other lists are bounded (one company's staff, a team's requests) and filterable; at larger scale Approvals, My requests, Team members and Users would use the same `page`/`page_size` pattern, with dashboard counts computed on the server |

## Assumptions, decisions and known limitations

Where the brief left details open, these decisions were made:

- **D1 – Pending requests reserve balance.** Available = allocated − used − pending. Balance is only *deducted*
  on approval (rule 5); pending requests just stop an employee from over-committing with several requests.
- **D2 – Organisation model: one admin, one manager level.** Employees report to a manager; managers and the
  admin have no manager. Think of each **manager** as an office's HR lead, approving leave only for their own
  office's staff, and the **admin** as the Director, who manages the setup, approves the managers' leave and can
  step in on any employee's request (rule 6 restricts managers to their own team; it does not restrict the admin).
  The brief lists "everything an employee can do" for managers but not for admins, so:
  - **the admin does not request leave**: `POST /leave-requests` is limited to employees and managers (admin → 403),
    and the admin has no leave menu, balances or allowances;
  - **there is exactly one admin account**: creating or promoting a second admin returns 409
    `ADMIN_ALREADY_EXISTS`, backed by a partial unique index in the database (migration `0002`).
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
- Users are deactivated, never deleted, to keep the audit history intact. A deactivated person's pending requests
  stay in the approval queue (badge **Deactivated**) so a manager or the admin can still close them. A manager with team members cannot be
  deactivated or demoted until the team is reassigned. Admins cannot demote or deactivate themselves.
- Viewing another person's request returns 403 (not 404).
- Managers' calendar shows their team and themselves; admins see everyone.

Known limitations:

- The lockout is per account, so someone could deliberately lock another user out for 15 minutes
  (use the `lockout-test` account to try it). Per-IP rate limiting would be the next step.
- No refresh tokens: users sign in again after 30 minutes.
- The free Render plan does not offer a fully private database network; external access is limited by Render's
  access-control list and still requires the generated password and SSL.
- Admins cannot change a user's email address.
- Seeded public holidays are illustrative, not an official calendar.
- Render free tier: the service sleeps when idle (slow first request) and the free database expires after 30 days.
