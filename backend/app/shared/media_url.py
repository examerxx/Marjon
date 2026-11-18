"""Абсолютные ссылки на медиа в ответах API.

Локальное хранилище (DEBUG без MinIO) сохраняет файлы рядом с бэкендом и
отдаёт ОТНОСИТЕЛЬНЫЙ путь ``/media/<bucket>/<key>``. Такой путь работает
только в браузере, который проксирует /media на тот же origin (веб-панель
через Vite). Десктоп и мобильное приложение рендерят URL как есть — для них
относительная строка неразрешима.

Здесь путь делается абсолютным под хост ТЕКУЩЕГО запроса: десктоп получает
``http://127.0.0.1:8000/media/...``, телефон через проброс — тот же путь на
``http://<ip-пк>:<порт>/media/...``. В БД по-прежнему лежит относительный
путь, поэтому адреса не «прилипают» к конкретному хосту.
"""

from __future__ import annotations

from contextvars import ContextVar

_ABSOLUTE_PREFIXES = ("http://", "https://", "data:", "blob:")

_request_origin: ContextVar[str | None] = ContextVar("media_request_origin", default=None)


def _origin_from_scope(scope: dict) -> str | None:
    headers = scope.get("headers") or ()
    host = None
    for key, value in headers:
        if key == b"host":
            host = value.decode("latin-1")
            break
    if not host:
        return None
    scheme = scope.get("scheme") or "http"
    return f"{scheme}://{host}"


class MediaUrlMiddleware:
    """Запоминает origin запроса, чтобы схемы ответа могли строить абсолютные ссылки."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        token = _request_origin.set(_origin_from_scope(scope))
        try:
            await self.app(scope, receive, send)
        finally:
            _request_origin.reset(token)


def absolute_media_url(url: str | None) -> str | None:
    """Относительный путь → абсолютный URL текущего запроса; остальное без изменений."""
    if not url or not url.startswith("/"):
        return url
    if url.startswith("//"):
        return url
    origin = _request_origin.get()
    if not origin:
        return url
    return origin.rstrip("/") + url
