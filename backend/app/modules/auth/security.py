from __future__ import annotations
import asyncio
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import bcrypt
from jose import JWTError, jwt
from starlette.concurrency import run_in_threadpool

from app.config import settings


# Service ("terminal") users: one per branch, created on branch-login. They
# are hidden from staff lists by this e-mail mask.
TERMINAL_EMAIL_LIKE = "terminal+%@marjon.local"


def terminal_email(branch_id) -> str:
    return f"terminal+{branch_id}@marjon.local"


def is_terminal_email(email: str | None) -> bool:
    return bool(email) and email.startswith("terminal+") and email.endswith("@marjon.local")


def _hash_password_sync(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify_password_sync(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


async def hash_password(password: str) -> str:
    """Off the event loop: bcrypt is deliberately slow (~200-300ms per call),
    and with uvicorn's single-worker default that would otherwise stall every
    other in-flight request — on every endpoint, for every client — for the
    duration of one password hash."""
    return await asyncio.to_thread(_hash_password_sync, password)


async def verify_password(plain: str, hashed: str) -> bool:
    """See hash_password — same event-loop-blocking concern, hit far more
    often (every login and PIN check)."""
    return await asyncio.to_thread(_verify_password_sync, plain, hashed)


# Псевдонимы: код, пришедший из ветки toast, зовёт те же обёртки под
# именами *_async. Реализация одна — обе уводят bcrypt в threadpool.
hash_password_async = hash_password
verify_password_async = verify_password


def create_access_token(
    user_id: UUID,
    company_id: UUID | None = None,
    auth_scope: str = "app",
    *,
    auth_version: int = 0,
    branch_id: UUID | None = None,
    support_session: bool = False,
) -> str:
    """auth_scope marks what this SESSION is authorized for, independent of the
    user's static is_superadmin flag — a superadmin who logs in through the
    regular /auth/login never gets an "hq_admin"-scoped token; only
    /auth/admin/login issues one (BE-01).

    branch_id — привязка сессии к филиалу (кухонный экран, терминал). Нужна,
    когда у сотрудника нет User.branch_id: реальный редактор сотрудников
    хранит филиал в HR-записи, а не в пользователе."""
    payload = {
        "sub": str(user_id),
        "company_id": str(company_id) if company_id else None,
        "jti": str(uuid4()),
        "type": "access",
        "auth_scope": auth_scope,
        "auth_version": auth_version,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes),
    }
    if support_session:
        payload["support_session"] = True
    if branch_id:
        payload["branch_id"] = str(branch_id)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def create_refresh_token(auth_scope: str = "app") -> str:
    """Create an opaque refresh token bound to the issuing session scope.

    The scope marker is not trusted on its own. Refresh only consumes it after
    the hash of the *entire* token matches a server-side RefreshToken row, so a
    caller cannot alter ``app`` to ``hq_admin`` without invalidating the token.
    Legacy unmarked tokens are treated as ordinary app sessions.
    """
    if auth_scope not in {"app", "hq_admin", "kitchen"}:
        raise ValueError("Unsupported auth scope")
    return f"v1.{auth_scope}.{secrets.token_urlsafe(64)}"


def is_access_token_current(payload: dict, user) -> bool:
    version = payload.get("auth_version", 0)
    return payload.get("type") == "access" and type(version) is int and version == (user.auth_version or 0)


def get_refresh_token_auth_scope(token: str) -> str:
    version, separator, remainder = token.partition(".")
    scope, scope_separator, secret = remainder.partition(".")
    if (
        version == "v1"
        and separator
        and scope_separator
        and secret
        and scope in {"app", "hq_admin", "kitchen"}
    ):
        return scope
    return "app"


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError as exc:
        raise exc
