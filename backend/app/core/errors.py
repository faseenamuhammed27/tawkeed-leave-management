"""Application errors and the single JSON error shape: {"detail": str, "code": str}.

Status code conventions:
  400 business rule blocked the action      401 not authenticated
  403 authenticated but not allowed         404 not found
  409 conflict (overlap, duplicate, wrong status)
  422 invalid input                         429 too many failed logins
"""

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    status_code = status.HTTP_400_BAD_REQUEST
    code = "BAD_REQUEST"

    def __init__(
        self,
        detail: str,
        code: str | None = None,
        *,
        extra: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ):
        super().__init__(detail)
        self.detail = detail
        if code:
            self.code = code
        self.extra = extra or {}
        self.headers = headers


class BusinessRuleError(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    code = "BUSINESS_RULE_VIOLATION"


class InvalidInputError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "VALIDATION_ERROR"


class AuthenticationError(AppError):
    status_code = status.HTTP_401_UNAUTHORIZED
    code = "NOT_AUTHENTICATED"

    def __init__(self, detail: str = "Not authenticated", code: str | None = None):
        super().__init__(detail, code, headers={"WWW-Authenticate": "Bearer"})


class PermissionDeniedError(AppError):
    status_code = status.HTTP_403_FORBIDDEN
    code = "FORBIDDEN"


class NotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    code = "NOT_FOUND"


class ConflictError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "CONFLICT"


class TooManyAttemptsError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "TOO_MANY_LOGIN_ATTEMPTS"


_HTTP_CODES = {
    401: "NOT_AUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        body = {"detail": exc.detail, "code": exc.code, **exc.extra}
        return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"field": ".".join(str(p) for p in err["loc"][1:]) or None, "message": err["msg"], "type": err["type"]}
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content=jsonable_encoder({"detail": "Request validation failed", "code": "VALIDATION_ERROR", "errors": errors}),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": exc.detail, "code": _HTTP_CODES.get(exc.status_code, "HTTP_ERROR")},
            headers=getattr(exc, "headers", None),
        )
