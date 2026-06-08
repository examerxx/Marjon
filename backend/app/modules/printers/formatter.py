"""
ESC/POS receipt and kitchen ticket formatters.
Returns bytes that can be sent directly to the printer.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from decimal import Decimal
from datetime import datetime


@dataclass
class ReceiptLine:
    name: str
    qty: Decimal
    price: Decimal
    total: Decimal
    modifiers: list[str] = field(default_factory=list)


@dataclass
class ReceiptData:
    company_name: str
    branch_name: str
    order_number: str
    order_type: str
    cashier_name: str
    items: list[ReceiptLine]
    subtotal: Decimal
    discount: Decimal
    tax: Decimal
    total: Decimal
    payment_method: str
    cash_received: Decimal | None = None
    change_given: Decimal | None = None
    table_number: str | None = None
    customer_name: str | None = None
    fiscal_code: str | None = None
    printed_at: datetime = field(default_factory=datetime.now)


@dataclass
class KitchenTicketData:
    order_number: str
    order_type: str
    table_number: str | None
    waiter_name: str | None
    items: list[dict]  # [{name, qty, note, modifiers, course}]
    note: str | None = None
    printed_at: datetime = field(default_factory=datetime.now)


class EscPosFormatter:
    """
    Generates ESC/POS byte sequences for thermal printers.
    Works without a physical printer — output is bytes.
    """

    ESC = b"\x1b"
    GS  = b"\x1d"
    LF  = b"\x0a"
    CUT = b"\x1d\x56\x41\x03"   # partial cut

    BOLD_ON     = ESC + b"\x45\x01"
    BOLD_OFF    = ESC + b"\x45\x00"
    ALIGN_LEFT  = ESC + b"\x61\x00"
    ALIGN_CENTER = ESC + b"\x61\x01"
    ALIGN_RIGHT = ESC + b"\x61\x02"
    DOUBLE_HEIGHT = GS + b"\x21\x01"
    NORMAL_SIZE   = GS + b"\x21\x00"
    INIT          = ESC + b"\x40"

    def __init__(self, paper_width: int = 80):
        # 80mm ≈ 48 chars; 58mm ≈ 32 chars
        self.cols = 48 if paper_width >= 80 else 32

    def _line(self, text: str = "") -> bytes:
        return text.encode("utf-8", errors="replace") + self.LF

    def _divider(self, char: str = "-") -> bytes:
        return self._line(char * self.cols)

    def _two_col(self, left: str, right: str) -> bytes:
        pad = self.cols - len(left) - len(right)
        return self._line(left + " " * max(pad, 1) + right)

    def _three_col(self, name: str, qty: str, total: str) -> bytes:
        qty_w = 6
        total_w = 10
        name_w = self.cols - qty_w - total_w
        name_trunc = name[:name_w].ljust(name_w)
        return self._line(name_trunc + qty.rjust(qty_w) + total.rjust(total_w))

    def format_receipt(self, data: ReceiptData) -> bytes:
        out = bytearray()
        out += self.INIT

        # Header
        out += self.ALIGN_CENTER
        out += self.BOLD_ON + self.DOUBLE_HEIGHT
        out += self._line(data.company_name[:self.cols])
        out += self.NORMAL_SIZE + self.BOLD_OFF
        out += self._line(data.branch_name[:self.cols])
        out += self.ALIGN_LEFT
        out += self._divider()

        # Order info
        out += self._two_col(f"Заказ #{data.order_number}", data.order_type)
        if data.table_number:
            out += self._line(f"Стол: {data.table_number}")
        if data.customer_name:
            out += self._line(f"Клиент: {data.customer_name}")
        out += self._line(f"Кассир: {data.cashier_name}")
        out += self._line(data.printed_at.strftime("%d.%m.%Y %H:%M:%S"))
        out += self._divider()

        # Items header
        out += self.BOLD_ON
        out += self._three_col("Наименование", "Кол.", "Сумма")
        out += self.BOLD_OFF
        out += self._divider()

        # Items
        for item in data.items:
            out += self._three_col(
                item.name,
                str(item.qty),
                f"{item.total:,.0f}",
            )
            for mod in item.modifiers:
                out += self._line(f"  + {mod}")

        out += self._divider()

        # Totals
        out += self._two_col("Итого:", f"{data.subtotal:,.0f}")
        if data.discount > 0:
            out += self._two_col("Скидка:", f"-{data.discount:,.0f}")
        if data.tax > 0:
            out += self._two_col("НДС (12%):", f"{data.tax:,.0f}")
        out += self.BOLD_ON
        out += self._two_col("К ОПЛАТЕ:", f"{data.total:,.0f}")
        out += self.BOLD_OFF
        out += self._divider()

        # Payment
        out += self._two_col("Оплата:", data.payment_method)
        if data.cash_received is not None:
            out += self._two_col("Получено:", f"{data.cash_received:,.0f}")
            out += self._two_col("Сдача:", f"{data.change_given or 0:,.0f}")

        # Fiscal code
        if data.fiscal_code:
            out += self._divider()
            out += self.ALIGN_CENTER
            out += self._line(f"ФН: {data.fiscal_code}")
            out += self.ALIGN_LEFT

        # Footer
        out += self._divider()
        out += self.ALIGN_CENTER
        out += self._line("Спасибо за покупку!")
        out += self.ALIGN_LEFT
        out += self.LF * 3
        out += self.CUT

        return bytes(out)

    def format_kitchen_ticket(self, data: KitchenTicketData) -> bytes:
        out = bytearray()
        out += self.INIT
        out += self.ALIGN_CENTER
        out += self.BOLD_ON + self.DOUBLE_HEIGHT
        out += self._line(f"ЗАКАЗ #{data.order_number}")
        out += self.NORMAL_SIZE + self.BOLD_OFF
        out += self._two_col(data.order_type.upper(), data.printed_at.strftime("%H:%M"))
        if data.table_number:
            out += self.BOLD_ON
            out += self._line(f"СТОЛ: {data.table_number}")
            out += self.BOLD_OFF
        if data.waiter_name:
            out += self._line(f"Официант: {data.waiter_name}")
        out += self.ALIGN_LEFT
        out += self._divider("=")

        # Group items by course
        courses: dict[int, list[dict]] = {}
        for item in data.items:
            c = item.get("course", 1)
            courses.setdefault(c, []).append(item)

        for course_num in sorted(courses):
            if len(courses) > 1:
                out += self.BOLD_ON
                out += self._line(f"--- Подача {course_num} ---")
                out += self.BOLD_OFF
            for item in courses[course_num]:
                qty = item.get("qty", 1)
                name = item.get("name", "")
                out += self.BOLD_ON
                out += self._line(f"  x{qty}  {name}")
                out += self.BOLD_OFF
                for mod in item.get("modifiers", []):
                    out += self._line(f"       + {mod}")
                if item.get("note"):
                    out += self._line(f"       ! {item['note']}")

        if data.note:
            out += self._divider()
            out += self._line(f"КОММЕНТАРИЙ: {data.note}")

        out += self._divider("=")
        out += self.LF * 3
        out += self.CUT
        return bytes(out)
