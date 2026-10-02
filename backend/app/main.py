from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.api.router import api_router
from app.core.config import get_settings
from app.core.errors import register_error_handlers

API_DESCRIPTION = """
Leave Management Portal API.

**Authentication:** call `POST /api/v1/auth/login`, then click **Authorize** and paste the `access_token`.

**Errors** always look like `{"detail": "...", "code": "MACHINE_CODE"}`:
400 business rule · 401 not logged in · 403 not allowed · 404 not found ·
409 conflict · 422 invalid input · 429 too many failed logins.
"""


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        description=API_DESCRIPTION,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # CORS is limited to the configured frontend origin(s); tokens travel in the
    # Authorization header, so cookies/credentials are not needed.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        return response

    register_error_handlers(app)
    app.include_router(api_router, prefix="/api/v1")

    @app.get("/health", tags=["Health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
