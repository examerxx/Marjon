from __future__ import annotations
from fastapi import Request
from jose import JWTError
from starlette.middleware.base import BaseHTTPMiddleware

from app.modules.auth.security import decode_token


class TenantMiddleware(BaseHTTPMiddleware):
    """Extracts company_id and user_id from JWT and stores in request.state."""

    async def dispatch(self, request: Request, call_next):
        request.state.user_id = None
        request.state.company_id = None

        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                payload = decode_token(token)
                request.state.user_id = payload.get("sub")
                request.state.company_id = payload.get("company_id")
            except JWTError:
                pass

        return await call_next(request)
