"""
ESC/POS receipt and kitchen ticket formatters.
Returns bytes that can be sent directly to the printer.
"""
from __future__ import annotations
import io
import logging
from dataclasses import dataclass, field
from decimal import Decimal
from datetime import datetime

logger = logging.getLogger(__name__)


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
    service_fee: Decimal = Decimal("0")
    waiter_name: str | None = None
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

    # GS ! n — character size (bits 0-2: height x1-x8, bits 4-6: width x1-x8).
    # "large" doubles height only (fits the same column count); "xlarge" doubles
    # both (halves the usable column count — callers must pass cols//2 to
    # _two_col/_line width-aware helpers for that block).
    _SIZE_CODES = {"standard": 0x00, "large": 0x01, "xlarge": 0x11}
    _ALIGN_CODES = {"left": ALIGN_LEFT, "center": ALIGN_CENTER, "right": ALIGN_RIGHT}

    # Соответствует умолчаниям frontend/src/api/receipt.js buildCustomerTemplate()
    # blockStyles — чтобы чек выглядел как превью в ReceiptSettingsPage даже до
    # того, как пользователь явно сохранит свои собственные стили блоков.
    _DEFAULT_BLOCK_STYLES: dict[str, dict] = {
        "restaurantName": {"size": "large", "align": "center", "weight": "bold"},
        "orderNumber": {"size": "standard", "align": "center", "weight": "bold"},
        "dateTime": {"size": "standard", "align": "center", "weight": "bold"},
        "total": {"size": "xlarge", "align": "left", "weight": "standard"},
        "thankYouText": {"size": "large", "align": "center", "weight": "bold"},
        "footerText": {"size": "large", "align": "center", "weight": "bold"},
    }

    # ESC/POS "select character code table" (ESC t n) — почти все ESC/POS
    # термопринтеры (даже дешёвые китайские клоны) печатают текст в 1-байтной
    # кодовой странице, а не в UTF-8. Без явной команды выбора таблицы
    # принтер остаётся на заводской (обычно PC437/USA) — отсюда «иероглифы»
    # на кириллице. n=17 (PC866) — самая совместимая кириллическая таблица,
    # поддерживается практически всеми клонами; n=71 (CP1251) — не входит в
    # оригинальный список Epson и поддерживается не всеми моделями.
    _CODEPAGES: dict[str, tuple[int | None, str]] = {
        "cp866": (17, "cp866"),
        "ibm866": (17, "cp866"),
        "cp1251": (71, "cp1251"),
        "windows-1251": (71, "cp1251"),
        "utf-8": (None, "utf-8"),
        "utf8": (None, "utf-8"),
    }

    def __init__(self, paper_width: int = 80, encoding: str = "cp866"):
        # 80mm ≈ 48 chars; 58mm ≈ 32 chars
        self.cols = 48 if paper_width >= 80 else 32

        page_n, codec = self._CODEPAGES.get((encoding or "").strip().lower(), self._CODEPAGES["cp866"])
        self._codec = codec
        # ESC t n — no-op (empty bytes) when the printer is left on UTF-8 mode
        self.codepage_cmd = self.ESC + b"\x74" + bytes([page_n]) if page_n is not None else b""

    # Типографские символы вне CP866/CP1251 (напр. "—" как заглушка "нет данных"
    # в service.py) без этого печатались как "?" — заменяем на ASCII-аналоги
    # перед кодировкой, а не только заменяем неизвестное на "?" в errors=.
    _CHAR_FALLBACKS = str.maketrans({
        "—": "-", "–": "-",  # — –
        "‘": "'", "’": "'",  # ' '
        "“": '"', "”": '"',  # " "
    })

    def _line(self, text: str = "") -> bytes:
        text = text.translate(self._CHAR_FALLBACKS)
        return text.encode(self._codec, errors="replace") + self.LF

    def _multiline(self, text: str) -> bytes:
        out = bytearray()
        for line in str(text).split("\n"):
            out += self._line(line)
        return bytes(out)

    def _logo_raster(self, logo_bytes: bytes) -> bytes | None:
        """Конвертирует произвольное растровое изображение (jpg/png/webp) в
        ESC/POS raster bit-image (GS v 0) — 1-бит монохром с дизерингом,
        вписанный по ширине бумаги. Возвращает None, если Pillow не установлен
        или файл повреждён — печать чека не должна падать из-за картинки."""
        try:
            from PIL import Image
        except ImportError:
            logger.warning("Pillow не установлен — логотип на чеке пропущен")
            return None

        max_width_px = self.cols * 12  # ~12 точек/символ при моноширинном шрифте 80/58мм
        try:
            img = Image.open(io.BytesIO(logo_bytes)).convert("L")
            if img.width > max_width_px:
                ratio = max_width_px / img.width
                img = img.resize((max_width_px, max(1, round(img.height * ratio))))
            img = img.convert("1")  # Floyd-Steinberg dithering по умолчанию
        except Exception as exc:
            logger.warning("Не удалось обработать лого для печати: %s", exc)
            return None

        width, height = img.size
        if width <= 0 or height <= 0:
            return None
        width_bytes = (width + 7) // 8
        pixels = img.load()
        data = bytearray(width_bytes * height)
        for y in range(height):
            row_offset = y * width_bytes
            for x in range(width):
                if pixels[x, y] == 0:  # 0 = чёрный после convert("1")
                    data[row_offset + x // 8] |= 0x80 >> (x % 8)

        header = self.GS + b"v0\x00" + bytes([
            width_bytes & 0xFF, (width_bytes >> 8) & 0xFF,
            height & 0xFF, (height >> 8) & 0xFF,
        ])
        return header + bytes(data)

    @staticmethod
    def _enabled(template: dict | None, key: str, default: bool = True) -> bool:
        """Читает template['enabled'][key] (формат frontend/src/api/receipt.js).
        Без шаблона (ещё не сохранён с фронта) — печатаем всё, как раньше."""
        if not template:
            return default
        enabled = template.get("enabled")
        if not isinstance(enabled, dict) or key not in enabled:
            return default
        return bool(enabled[key])

    def _block_style(self, template: dict, key: str) -> dict:
        """template['blockStyles'][key] (size/align/weight), см. ReceiptSectionEditor.
        Отсутствующие поля берутся из _DEFAULT_BLOCK_STYLES (те же дефолты, что
        показывает превью на фронте), а не просто 'standard' — иначе чек без
        явно сохранённых стилей выглядел бы монотонным, не как в превью."""
        styles = template.get("blockStyles") or {}
        return {**self._DEFAULT_BLOCK_STYLES.get(key, {}), **(styles.get(key) or {})}

    def _style_bytes(self, style: dict) -> tuple[bytes, bytes, int]:
        """(prefix, suffix, width_divisor) для набора style — GS!/ESC E/ESC a.
        width_divisor=2 для 'xlarge' (двойная ширина съедает половину колонок
        на строке — вызывающий код должен передать cols // width_divisor в
        _two_col/_three_col для этой строки, чтобы не переполнить бумагу)."""
        align = style.get("align", "left")
        weight = style.get("weight", "standard")
        size = style.get("size", "standard")

        prefix = bytearray()
        prefix += self._ALIGN_CODES.get(align, self.ALIGN_LEFT)
        size_code = self._SIZE_CODES.get(size, 0x00)
        if size_code:
            prefix += self.GS + b"\x21" + bytes([size_code])
        if weight == "bold":
            prefix += self.BOLD_ON

        suffix = bytearray()
        if weight == "bold":
            suffix += self.BOLD_OFF
        if size_code:
            suffix += self.NORMAL_SIZE
        suffix += self.ALIGN_LEFT

        width_divisor = 2 if size == "xlarge" else 1
        return bytes(prefix), bytes(suffix), width_divisor

    def _styled_line(self, template: dict, key: str, text: str) -> bytes:
        """Многострочный текст (thankYouText/footerText/название заведения) с
        учётом стиля блока key."""
        prefix, suffix, _ = self._style_bytes(self._block_style(template, key))
        return prefix + self._multiline(text) + suffix

    def _divider(self, char: str = "-") -> bytes:
        return self._line(char * self.cols)

    def _two_col(self, left: str, right: str, cols: int | None = None) -> bytes:
        cols = self.cols if cols is None else cols
        pad = cols - len(left) - len(right)
        return self._line(left + " " * max(pad, 1) + right)

    def _three_col(self, name: str, qty: str, total: str) -> bytes:
        qty_w = 6
        total_w = 10
        name_w = self.cols - qty_w - total_w
        name_trunc = name[:name_w].ljust(name_w)
        return self._line(name_trunc + qty.rjust(qty_w) + total.rjust(total_w))

    def format_receipt(self, data: ReceiptData, template: dict | None = None, logo_bytes: bytes | None = None) -> bytes:
        """template — сохранённый с фронта шаблон (см. frontend/src/api/receipt.js,
        buildCustomerTemplate()): какие блоки включены (template['enabled']),
        подписи (thankYouText/footerText/restaurantName/address/phone). Без
        шаблона (ещё не настроен) печатаем все блоки — прежнее поведение.
        logo_bytes — сырые байты загруженного лого компании (jpg/png/webp),
        печатается растром (GS v 0), если блок 'logo' включён и лого загружено.
        QR намеренно не печатается с этого принтера — печатается отдельным
        QR-принтером вне этого проекта, поэтому блок 'qr' здесь не реализован."""
        template = template or {}
        en = lambda key, default=True: self._enabled(template, key, default)  # noqa: E731

        out = bytearray()
        out += self.INIT
        out += self.codepage_cmd

        # Header
        if en("logo") and logo_bytes:
            raster = self._logo_raster(logo_bytes)
            if raster:
                out += self.ALIGN_CENTER
                out += raster
                out += self.LF
                out += self.ALIGN_LEFT
        if en("restaurantName"):
            name = str(template.get("restaurantName") or data.company_name)
            out += self._styled_line(template, "restaurantName", name[:self.cols])
            out += self.ALIGN_CENTER
            out += self._line(data.branch_name[:self.cols])
            out += self.ALIGN_LEFT
        if en("address") and template.get("address"):
            out += self.ALIGN_CENTER
            out += self._line(str(template["address"])[:self.cols])
            out += self.ALIGN_LEFT
        if en("phone") and template.get("phone"):
            out += self.ALIGN_CENTER
            out += self._line(str(template["phone"])[:self.cols])
            out += self.ALIGN_LEFT
        out += self._divider()

        # Order info
        if en("orderNumber"):
            style = self._block_style(template, "orderNumber")
            prefix, suffix, div = self._style_bytes(style)
            out += prefix
            out += self._two_col(f"Заказ #{data.order_number}", data.order_type, cols=self.cols // div)
            out += suffix
        if en("table") and data.table_number:
            out += self._line(f"Стол: {data.table_number}")
        if data.customer_name:
            out += self._line(f"Клиент: {data.customer_name}")
        if en("waiter") and (data.waiter_name or data.cashier_name):
            out += self._line(f"Официант: {data.waiter_name or data.cashier_name}")
        if en("dateTime"):
            out += self._styled_line(template, "dateTime", data.printed_at.strftime("%d.%m.%Y %H:%M:%S"))
        out += self._divider()

        # Items
        if en("items"):
            out += self.BOLD_ON
            out += self._three_col("Наименование", "Кол.", "Сумма")
            out += self.BOLD_OFF
            out += self._divider()
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
        if en("discount") and data.discount > 0:
            out += self._two_col("Скидка:", f"-{data.discount:,.0f}")
        if en("serviceFee") and getattr(data, "service_fee", 0) and data.service_fee > 0:
            out += self._two_col("Обслуживание:", f"{data.service_fee:,.0f}")
        if en("vat") and data.tax > 0:
            vat_rate = template.get("vatRate")
            label = f"НДС ({vat_rate:.0f}%):" if vat_rate else "НДС:"
            out += self._two_col(label, f"{data.tax:,.0f}")
        total_style = self._block_style(template, "total")
        total_prefix, total_suffix, total_div = self._style_bytes(total_style)
        out += total_prefix
        out += self._two_col("К ОПЛАТЕ:", f"{data.total:,.0f}", cols=self.cols // total_div)
        out += total_suffix
        out += self._divider()

        # Payment
        if en("paymentMethod"):
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
        if en("thankYouText"):
            out += self._divider()
            out += self._styled_line(template, "thankYouText", template.get("thankYouText") or "Спасибо за покупку!")
        if en("footerText") and template.get("footerText"):
            out += self._styled_line(template, "footerText", template["footerText"])

        out += self.LF * 3
        out += self.CUT

        return bytes(out)

    def format_kitchen_ticket(self, data: KitchenTicketData, template: dict | None = None) -> bytes:
        """template — см. frontend/src/api/receipt.js buildKitchenTemplate():
        {enabled: {orderNumber, table, waiter, createdAt, items, modifiers,
        itemComments, orderNote, priority, ...}}. Без шаблона — печатаем всё."""
        template = template or {}
        en = lambda key, default=True: self._enabled(template, key, default)  # noqa: E731

        out = bytearray()
        out += self.INIT
        out += self.codepage_cmd
        out += self.ALIGN_CENTER
        out += self.BOLD_ON + self.DOUBLE_HEIGHT
        if en("orderNumber"):
            out += self._line(f"ЗАКАЗ #{data.order_number}")
        out += self.NORMAL_SIZE + self.BOLD_OFF
        if en("createdAt"):
            out += self._two_col(data.order_type.upper(), data.printed_at.strftime("%H:%M"))
        else:
            out += self._line(data.order_type.upper())
        if en("table") and data.table_number:
            out += self.BOLD_ON
            out += self._line(f"СТОЛ: {data.table_number}")
            out += self.BOLD_OFF
        if en("waiter") and data.waiter_name:
            out += self._line(f"Официант: {data.waiter_name}")
        out += self.ALIGN_LEFT
        out += self._divider("=")

        if en("items"):
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
                    if en("modifiers"):
                        for mod in item.get("modifiers", []):
                            out += self._line(f"       + {mod}")
                    if en("itemComments") and item.get("note"):
                        out += self._line(f"       ! {item['note']}")

        if en("orderNote") and data.note:
            out += self._divider()
            out += self._line(f"КОММЕНТАРИЙ: {data.note}")

        out += self._divider("=")
        out += self.LF * 3
        out += self.CUT
        return bytes(out)
