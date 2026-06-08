"""
Low-level printer communication.
Supports: TCP/IP network printers, USB (via file path), Serial.
"""
from __future__ import annotations
import asyncio
import socket
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.modules.printers.models import Printer


class PrinterError(Exception):
    pass


async def send_to_network_printer(ip: str, port: int, data: bytes, timeout: int = 5) -> None:
    """Send raw ESC/POS bytes to a network printer via TCP."""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port),
            timeout=timeout,
        )
        writer.write(data)
        await writer.drain()
        writer.close()
        await writer.wait_closed()
    except asyncio.TimeoutError:
        raise PrinterError(f"Timeout connecting to printer {ip}:{port}")
    except OSError as e:
        raise PrinterError(f"Cannot reach printer {ip}:{port} — {e}")


def send_to_usb_printer(device_path: str, data: bytes) -> None:
    """Write raw ESC/POS bytes to a USB/Serial printer device file."""
    try:
        with open(device_path, "wb") as f:
            f.write(data)
    except OSError as e:
        raise PrinterError(f"Cannot write to {device_path} — {e}")


async def print_raw(printer, data: bytes) -> None:
    """Dispatch to correct transport based on printer config."""
    if printer.connection_type == "network":
        if not printer.ip_address:
            raise PrinterError("Network printer missing ip_address")
        await send_to_network_printer(printer.ip_address, printer.port, data)
    elif printer.connection_type in ("usb", "serial"):
        if not printer.device_path:
            raise PrinterError("USB/Serial printer missing device_path")
        await asyncio.get_event_loop().run_in_executor(
            None, send_to_usb_printer, printer.device_path, data
        )
    else:
        raise PrinterError(f"Unknown connection_type: {printer.connection_type}")
