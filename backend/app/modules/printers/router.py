from __future__ import annotations
from uuid import UUID
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

import asyncio
from app.infrastructure.database.session import get_db
from app.modules.auth.dependencies import get_current_user, require_company_admin
from app.modules.auth.models import User
from app.modules.auth.repository import UserRepository
from app.modules.auth.security import decode_token
from app.modules.printers.schemas import (
    PrinterCreate, PrinterResponse, PrinterTestRequest, PrinterUpdate,
    PrintJobResponse, PrintKitchenRequest, PrintReceiptRequest,
)
from app.modules.printers.service import PrinterService
from app.modules.printers.printer_client import send_to_network_printer, PrinterError
from app.modules.printers.ws_manager import printer_ws_manager
from app.shared.exceptions import NotFoundError

router = APIRouter(prefix="/printers", tags=["printers"])


@router.get("/ping", summary="Check if a printer is reachable on the network")
async def ping_printer(
    ip: str = Query(..., description="Printer IP address, e.g. 192.168.1.100"),
    port: int = Query(9100, description="Printer port (default 9100 for ESC/POS)"),
    _: User = Depends(get_current_user),
):
    """
    Quickly check if a printer is reachable before adding it.
    Does NOT print anything.
    """
    try:
        # Send empty bytes just to test TCP connection
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=3
        )
        writer.close()
        await writer.wait_closed()
        return {"reachable": True, "ip": ip, "port": port, "message": "Printer is online"}
    except asyncio.TimeoutError:
        return {"reachable": False, "ip": ip, "port": port, "message": f"Timeout — no response on {ip}:{port}"}
    except OSError as e:
        return {"reachable": False, "ip": ip, "port": port, "message": str(e)}


# ── Printer management ────────────────────────────────────────────────────────

@router.post("", response_model=PrinterResponse, status_code=status.HTTP_201_CREATED)
async def create_printer(
    data: PrinterCreate,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    return await PrinterService(db).create(user.company_id, data)


@router.get("", response_model=list[PrinterResponse])
async def list_printers(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await PrinterService(db).list(user.company_id)


@router.get("/{printer_id}", response_model=PrinterResponse)
async def get_printer(
    printer_id: UUID,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    return await PrinterService(db).get(user.company_id, printer_id)


@router.patch("/{printer_id}", response_model=PrinterResponse)
async def update_printer(
    printer_id: UUID,
    data: PrinterUpdate,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    return await PrinterService(db).update(user.company_id, printer_id, data)


@router.delete("/{printer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_printer(
    printer_id: UUID,
    user: User = Depends(require_company_admin),
    db: AsyncSession = Depends(get_db),
):
    await PrinterService(db).delete(user.company_id, printer_id)


# ── Print actions ──────────────────────────────────────────────────────────────

@router.post("/test", response_model=PrintJobResponse)
async def test_print(
    data: PrinterTestRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a test page to the printer."""
    return await PrinterService(db).test_print(user.company_id, data.printer_id)


@router.post("/print/receipt", response_model=PrintJobResponse)
async def print_receipt(
    data: PrintReceiptRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Print customer receipt for an order."""
    return await PrinterService(db).print_receipt(
        user.company_id, data.order_id, data.printer_id, data.copies
    )


@router.post("/print/kitchen", response_model=PrintJobResponse)
async def print_kitchen(
    data: PrintKitchenRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Print kitchen ticket for an order."""
    return await PrinterService(db).print_kitchen_ticket(
        user.company_id, data.order_id, data.printer_id, data.copies
    )


# ── BE-12 compat shims ───────────────────────────────────────────────────────
# The two canonical endpoints above (POST /print/receipt, POST /print/kitchen)
# are the contract this ticket asked for — explicit printer_id, one API for
# every client. frontend/src/api/receipt.js, however, has always called
# POST /print/orders/{order_id}/receipt|kitchen with an EMPTY body (no
# printer_id at all), which 404s against the canonical routes — meaning
# receipt/kitchen printing from the web app has never actually reached this
# backend. Per the ТЗ's "не трогать frontend" boundary, this is a backend-
# only compat route rather than a frontend fix: it auto-selects the branch's
# active printer(s) of the right type instead of requiring an explicit one.
@router.post("/print/orders/{order_id}/receipt", response_model=list[PrintJobResponse])
async def print_order_receipt_compat(
    order_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = PrinterService(db)
    order = await svc.get_order_for_print(user.company_id, order_id)
    jobs = await svc.auto_print_receipt(user.company_id, order.branch_id, order_id)
    if not jobs:
        raise NotFoundError("Для этого филиала не настроен принтер чеков")
    return jobs


@router.post("/print/orders/{order_id}/kitchen", response_model=list[PrintJobResponse])
async def print_order_kitchen_compat(
    order_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    svc = PrinterService(db)
    order = await svc.get_order_for_print(user.company_id, order_id)
    jobs = await svc.auto_print_kitchen(user.company_id, order.branch_id, order_id)
    if not jobs:
        raise NotFoundError("Для этого филиала не настроен кухонный принтер")
    return jobs


# ── Job queue (for local POS terminals) ───────────────────────────────────────

@router.get("/{printer_id}/jobs/pending", response_model=list[PrintJobResponse])
async def pending_jobs(
    printer_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """POS terminal polls this to get queued jobs for local printing."""
    return await PrinterService(db).get_pending_jobs(user.company_id, printer_id)


@router.post("/jobs/{job_id}/done", response_model=PrintJobResponse)
async def mark_done(
    job_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """POS terminal marks job as printed."""
    return await PrinterService(db).mark_job_done(user.company_id, job_id)


# ── WebSocket (desktop terminal push) ─────────────────────────────────────────

@router.websocket("/ws/{branch_id}")
async def printer_ws_endpoint(
    ws: WebSocket,
    branch_id: UUID,
    token: str = Query(..., description="JWT access token"),
    db: AsyncSession = Depends(get_db),
):
    """
    Desktop terminal connects here to receive print jobs in real time.
    URL: ws://host/api/v1/printers/ws/{branch_id}?token=<jwt>
    """
    try:
        from jose import JWTError
        payload = decode_token(token)
        user_id = UUID(payload["sub"])
        user = await UserRepository(db).get_by_id(user_id)
        if not user or not user.is_active or not user.company_id:
            await ws.close(code=4001, reason="Unauthorized")
            return
    except Exception:
        await ws.close(code=4001, reason="Unauthorized")
        return

    await printer_ws_manager.connect(ws, user.company_id, branch_id)
    try:
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text("pong")
    except WebSocketDisconnect:
        printer_ws_manager.disconnect(ws, user.company_id, branch_id)
