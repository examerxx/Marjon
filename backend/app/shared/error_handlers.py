"""BE-21: unified error contract.

Every error response FastAPI/this backend produces already carries
`detail` (either a string, from HTTPException/our shared/exceptions.py
subclasses, or a list of pydantic error dicts, from automatic request
validation) — dozens of frontend call sites across both apps read
`err.response.data.detail` directly, so that field is kept exactly as-is.
These handlers ADD `code`/`message`/`details`/`field_errors` alongside it
rather than replacing anything, giving every error response the same
envelope shape the spec asks for without touching a single frontend call
site.
"""
from __future__ import annotations

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

_CODE_BY_STATUS: dict[int, str] = {
    status.HTTP_400_BAD_REQUEST: "BAD_REQUEST",
    status.HTTP_401_UNAUTHORIZED: "UNAUTHORIZED",
    status.HTTP_403_FORBIDDEN: "PERMISSION_DENIED",
    status.HTTP_404_NOT_FOUND: "NOT_FOUND",
    status.HTTP_409_CONFLICT: "CONFLICT",
    status.HTTP_422_UNPROCESSABLE_ENTITY: "VALIDATION_ERROR",
    status.HTTP_429_TOO_MANY_REQUESTS: "RATE_LIMITED",
    status.HTTP_500_INTERNAL_SERVER_ERROR: "INTERNAL_ERROR",
}


def _envelope(detail, *, code: str, message: str, field_errors: dict | None = None) -> dict:
    return {
        "detail": detail,
        "code": code,
        "message": message,
        "details": None,
        "field_errors": field_errors or {},
    }


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _CODE_BY_STATUS.get(exc.status_code, "ERROR")
        message = exc.detail if isinstance(exc.detail, str) else "Error"
        body = _envelope(exc.detail, code=code, message=message)
        return JSONResponse(status_code=exc.status_code, content=jsonable_encoder(body), headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        field_errors: dict[str, str] = {}
        for err in exc.errors():
            loc = ".".join(str(p) for p in err.get("loc", ()) if p != "body")
            field_errors[loc or "_"] = err.get("msg", "Invalid value")
        body = _envelope(
            jsonable_encoder(exc.errors()),
            code="VALIDATION_ERROR", message="Ошибка валидации данных",
            field_errors=field_errors,
        )
        return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content=body)
