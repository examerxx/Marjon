from __future__ import annotations

"""Клиент внешней системы devent (ТЗ §8).

Контракт API devent — открытый вопрос ТЗ; клиент инкапсулирует HTTP-вызовы
с ретраями. Ожидаемый формат ответов:
  GET {base}/employees -> [{"id": "...", "fio": "...", "phone": "...", "role": "..."}]
  GET {base}/services  -> [{"id": "...", "name": "..."}]
"""

import asyncio
import logging

import httpx
from fastapi import HTTPException, status

from app.config import settings

logger = logging.getLogger(__name__)


class DeventClient:
    RETRIES = 3

    def __init__(self) -> None:
        if not settings.devent_base_url:
            raise HTTPException(
                status_code=status.HTTP_501_NOT_IMPLEMENTED,
                detail="Интеграция devent не настроена (DEVENT_BASE_URL)",
            )
        self.base_url = settings.devent_base_url.rstrip("/")
        self.headers = (
            {"Authorization": f"Bearer {settings.devent_api_key}"}
            if settings.devent_api_key else {}
        )

    async def _get(self, path: str) -> list[dict]:
        last_error: Exception | None = None
        for attempt in range(1, self.RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    response = await client.get(f"{self.base_url}{path}", headers=self.headers)
                    response.raise_for_status()
                    return response.json()
            except (httpx.HTTPError, ValueError) as e:
                last_error = e
                logger.warning("devent %s: попытка %d/%d не удалась: %s", path, attempt, self.RETRIES, e)
                await asyncio.sleep(attempt)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"devent недоступен: {last_error}",
        )

    async def fetch_employees(self) -> list[dict]:
        return await self._get("/employees")

    async def fetch_services(self) -> list[dict]:
        return await self._get("/services")
