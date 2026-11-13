from __future__ import annotations
import asyncio
import json
import logging
import time
from uuid import UUID

from fastapi import Depends, Query, WebSocket, WebSocketDisconnect
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import ensure_company_app_identity
from app.modules.auth.repository import UserRepository
from app.modules.auth.security import decode_token
from app.modules.companies.models import Branch
from app.shared.tenant_scope import require_company_resource

logger = logging.getLogger(__name__)

# ── Redis publish: короткий таймаут + предохранитель ─────────────────────────
# POS-REALTIME-LAT-01. `broadcast()` вызывается прямо в пути запроса (создание
# заказа, смена статуса, оплата). Раньше на каждый вызов создавался новый клиент
# redis-py с дефолтной политикой ретраев: если Redis недоступен, publish
# повторялся с backoff и держал HTTP-запрос ~4 секунды. Локально (без Redis)
# «Создать заказ» отвечал 4.1 с вместо ~10 мс.
#
# Теперь: один переиспользуемый клиент, таймаут соединения 0.25 с и НОЛЬ
# ретраев. Неудачная попытка взводит предохранитель на 30 с — в течение этого
# окна события доставляются только локальным подключениям, без обращения к
# Redis. Реальная доставка между воркерами не страдает: как только Redis
# оживает, следующая попытка после окна снова идёт в pub/sub.
_REDIS_DOWN_SECONDS = 30.0
_redis_down_until: float = 0.0
_redis_publish_client = None


def _publish_client():
    """Один клиент на процесс: соединение переиспользуется между событиями."""
    global _redis_publish_client
    if _redis_publish_client is None:
        import redis.asyncio as aioredis
        from redis.asyncio.retry import Retry
        from redis.backoff import NoBackoff

        _redis_publish_client = aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=0.25,
            socket_timeout=0.25,
            retry=Retry(NoBackoff(), 0),
            retry_on_timeout=False,
        )
    return _redis_publish_client


class KitchenConnectionManager:
    """
    Scoped by "{company_id}:{branch_id}".

    Broadcast strategy:
    - If Redis is configured: publish to Redis channel so ALL uvicorn workers
      deliver the message to their local WebSocket clients (multi-worker safe).
    - If Redis is unavailable: fall back to in-process delivery (single-worker only).
    """

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}
        self._listeners:   dict[WebSocket, asyncio.Task] = {}

    # ── helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _key(company_id: UUID, branch_id: UUID) -> str:
        return f"{company_id}:{branch_id}"

    @staticmethod
    def _channel(key: str) -> str:
        return f"kitchen:{key}"

    # ── connection lifecycle ──────────────────────────────────────────────────

    async def connect(self, ws: WebSocket, company_id: UUID, branch_id: UUID) -> None:
        await ws.accept()
        key = self._key(company_id, branch_id)
        self._connections.setdefault(key, set()).add(ws)

        # Forward Redis messages to this specific client
        task = asyncio.create_task(
            self._redis_forward(ws, self._channel(key)),
            name=f"kitchen-redis-{id(ws)}",
        )
        self._listeners[ws] = task
        logger.info("Kitchen WS connected: %s total=%d", key, len(self._connections[key]))

    def disconnect(self, ws: WebSocket, company_id: UUID, branch_id: UUID) -> None:
        key = self._key(company_id, branch_id)
        conns = self._connections.get(key)
        if conns:
            conns.discard(ws)
            if not conns:
                del self._connections[key]
        task = self._listeners.pop(ws, None)
        if task:
            task.cancel()

    # ── broadcast ─────────────────────────────────────────────────────────────

    async def broadcast(
        self,
        company_id: UUID,
        branch_id: UUID,
        event_type: str,
        data: dict | None = None,
    ) -> None:
        global _redis_down_until

        key = self._key(company_id, branch_id)
        message = json.dumps({"type": event_type, "data": data or {}})

        # POS-REALTIME-LAT-01: путь запроса не должен ждать Redis. См. блок
        # _REDIS_DOWN_SECONDS выше — при недоступном Redis здесь максимум 0.25 с
        # на первую попытку и 0 с на все последующие в течение окна.
        if settings.redis_url and time.monotonic() >= _redis_down_until:
            try:
                await _publish_client().publish(self._channel(key), message)
                return  # _redis_forward tasks handle local delivery
            except Exception as exc:
                _redis_down_until = time.monotonic() + _REDIS_DOWN_SECONDS
                logger.warning(
                    "Redis publish failed (%s) — in-process delivery for %.0fs",
                    exc, _REDIS_DOWN_SECONDS,
                )

        # Fallback: deliver directly to in-process connections only
        await self._send_local(key, message)

    # ── internals ─────────────────────────────────────────────────────────────

    async def _send_local(self, key: str, message: str) -> None:
        conns = self._connections.get(key, set())
        closed: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_text(message)
            except Exception:
                closed.append(ws)
        for ws in closed:
            conns.discard(ws)

    async def _redis_forward(self, ws: WebSocket, channel: str) -> None:
        """Subscribe to a Redis channel and forward every message to `ws`."""
        if not settings.redis_url:
            return  # No Redis — broadcast falls back to _send_local

        try:
            import redis.asyncio as aioredis
            # Короткий connect-таймаут: без Redis этот слушатель иначе держал бы
            # открытие WebSocket-подключения на дефолтном TCP-таймауте.
            client = aioredis.from_url(
                settings.redis_url,
                decode_responses=True,
                socket_connect_timeout=2,
            )
            pubsub = client.pubsub()
            await pubsub.subscribe(channel)
            async for msg in pubsub.listen():
                if msg["type"] == "message":
                    try:
                        await ws.send_text(msg["data"])
                    except Exception:
                        break  # WS closed — stop listener
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.warning("Redis forward error on %s: %s", channel, exc)
        finally:
            try:
                await pubsub.unsubscribe(channel)
                await client.aclose()
            except Exception:
                pass


kitchen_manager = KitchenConnectionManager()


async def kitchen_ws_endpoint(
    ws: WebSocket,
    token: str = Query(...),
    branch_id: UUID = Query(...),
    db: AsyncSession = Depends(get_db),
) -> None:
    try:
        payload = decode_token(token)
    except JWTError:
        await ws.close(code=4001, reason="Invalid token")
        return

    user_id_str = payload.get("sub")
    if not user_id_str:
        await ws.close(code=4002, reason="Company app session required")
        return
    try:
        user = await UserRepository(db).get_by_id(UUID(user_id_str))
    except (ValueError, TypeError):
        user = None
    from app.modules.auth.security import is_access_token_current
    if not user or not user.is_active or not is_access_token_current(payload, user):
        await ws.close(code=4001, reason="Unauthorized")
        return
    try:
        await ensure_company_app_identity(
            user, db, auth_scope=payload.get("auth_scope", "app"),
            allowed_scopes=("app", "kitchen"),
        )
        # Кухонная сессия привязана к филиалу: подписаться на чужой канал нельзя.
        raw_branch = payload.get("branch_id")
        if payload.get("auth_scope") == "kitchen" and not raw_branch:
            raise ValueError("Kitchen session requires a signed branch")
        session_branch = UUID(raw_branch) if raw_branch is not None else user.branch_id
        if session_branch and session_branch != branch_id:
            raise ValueError("branch mismatch")
        await require_company_resource(
            db, Branch, branch_id, user.company_id, detail="Branch not found"
        )
    except Exception:
        await ws.close(code=4003, reason="Branch not found")
        return

    company_id = user.company_id
    await kitchen_manager.connect(ws, company_id, branch_id)
    try:
        while True:
            await ws.receive_text()  # keep alive; client can send pings
    except WebSocketDisconnect:
        pass
    finally:
        kitchen_manager.disconnect(ws, company_id, branch_id)
