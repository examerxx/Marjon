"""
Print Agent — запускается на POS терминале (локальная сеть).
Опрашивает API, скачивает задания, отправляет на локальный принтер.

Запуск:
    python agent.py --api https://your-app.fastapicloud.com --token YOUR_TOKEN
"""
from __future__ import annotations
import asyncio
import base64
import json
import logging
import socket
import sys
from pathlib import Path

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("print-agent")

# ── Конфигурация ──────────────────────────────────────────────────────────────

CONFIG_FILE = Path(__file__).parent / "agent_config.json"

DEFAULT_CONFIG = {
    "api_url": "http://localhost:8000",
    "token": "",
    "poll_interval_seconds": 3,
    # Список принтеров: {printer_id → local ip:port}
    # Если пусто — берём IP/port из записи принтера в БД
    "printers": {}
}


def load_config() -> dict:
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return {**DEFAULT_CONFIG, **json.load(f)}
    # Создать дефолтный конфиг при первом запуске
    with open(CONFIG_FILE, "w") as f:
        json.dump(DEFAULT_CONFIG, f, indent=2, ensure_ascii=False)
    log.info("Created default config: %s", CONFIG_FILE)
    return DEFAULT_CONFIG.copy()


# ── Печать ────────────────────────────────────────────────────────────────────

async def send_to_printer(ip: str, port: int, data: bytes) -> None:
    reader, writer = await asyncio.wait_for(
        asyncio.open_connection(ip, port), timeout=5
    )
    writer.write(data)
    await writer.drain()
    writer.close()
    await writer.wait_closed()


# ── Основной цикл ─────────────────────────────────────────────────────────────

async def run(config: dict) -> None:
    api = config["api_url"].rstrip("/")
    headers = {"Authorization": f"Bearer {config['token']}"}

    log.info("Print Agent started. Polling %s every %ss",
             api, config["poll_interval_seconds"])

    async with httpx.AsyncClient(headers=headers, timeout=10) as client:
        # Получить список принтеров этой компании
        resp = await client.get(f"{api}/api/v1/printers")
        if resp.status_code != 200:
            log.error("Cannot fetch printers: %s", resp.text)
            return

        printers = resp.json()
        if not printers:
            log.warning("No printers registered. Add printers via API first.")
            return

        log.info("Monitoring %d printer(s):", len(printers))
        for p in printers:
            log.info("  [%s] %s — %s:%s", p["printer_type"], p["name"],
                     p.get("ip_address", "?"), p.get("port", 9100))

        while True:
            for printer in printers:
                pid = printer["id"]

                # Переопределить IP из локального конфига если задано
                local = config["printers"].get(pid, {})
                ip   = local.get("ip") or printer.get("ip_address")
                port = local.get("port") or printer.get("port", 9100)

                if not ip:
                    continue

                # Получить очередь заданий
                resp = await client.get(f"{api}/api/v1/printers/{pid}/jobs/pending")
                if resp.status_code != 200:
                    continue

                jobs = resp.json()
                for job in jobs:
                    job_id = job["id"]
                    try:
                        raw = base64.b64decode(job["payload"])
                        for _ in range(job.get("copies", 1)):
                            await send_to_printer(ip, port, raw)

                        # Подтвердить выполнение
                        await client.post(f"{api}/api/v1/printers/jobs/{job_id}/done")
                        log.info("[%s] Printed job %s (%s bytes)",
                                 printer["name"], job_id[:8], len(raw))

                    except Exception as e:
                        log.error("[%s] Failed job %s: %s",
                                  printer["name"], job_id[:8], e)

            await asyncio.sleep(config["poll_interval_seconds"])


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="POS Print Agent")
    parser.add_argument("--api",   help="API URL, e.g. https://app.fastapicloud.com")
    parser.add_argument("--token", help="Bearer token (from /auth/login)")
    parser.add_argument("--interval", type=int, help="Poll interval seconds (default 3)")
    args = parser.parse_args()

    cfg = load_config()
    if args.api:
        cfg["api_url"] = args.api
    if args.token:
        cfg["token"] = args.token
    if args.interval:
        cfg["poll_interval_seconds"] = args.interval

    if not cfg["token"]:
        log.error("Token is required. Use --token or set in %s", CONFIG_FILE)
        sys.exit(1)

    asyncio.run(run(cfg))
