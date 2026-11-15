"""
ESC/POS receipt and kitchen ticket formatters.
Returns bytes that can be sent directly to the printer.

Customer receipt content/behavior is the physical-print half of the frozen
contract in frontend/src/api/receipt.js, frontend/src/components/receipt/
ReceiptPreview.jsx and receiptBlockCapabilities.js (branch
receipt-density-tune-v1, commit 615dce6). Kitchen ticket mirrors the same
files' KITCHEN_BLOCKS (8-row constructor) and buildKitchenTemplate().
"""
from __future__ import annotations
import io
import logging
from dataclasses import dataclass, field, replace
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime
from app.modules.printers.receipt_layout import grouped_items, separator_style

logger = logging.getLogger(__name__)

# Канонические коды типов заказа (pos.order_type) → подпись на чеке/тикете:
# на чеке всегда тот тип, что выбран при заказе. Неизвестные значения
# печатаются как есть — строка типа не должна пропадать. Независимый от
# app/modules/admin_reports/service.py::ORDER_TYPE_LABELS (там "На месте"
# для dine_in) — разная аудитория, разная формулировка допускается.
ORDER_TYPE_LABELS = {
    "dine_in": "На стол",
    "takeaway": "На вынос",
    "delivery": "Доставка",
    "qr": "QR",
}


def format_kitchen_order_type(value) -> str:
    """Kitchen uses the same takeaway label as the POS button."""
    return "С собой" if value in ("takeaway", "На вынос", "НА ВЫНОС") else format_order_type(value)

PAYMENT_METHOD_LABELS = {
    "cash": "Наличные",
    "card": "Карта",
    "click": "Click",
    "payme": "Payme",
    "uzum": "Uzum",
    "loyalty": "Бонусы",
    "mixed": "Смешанная оплата",
}


def format_quantity(qty) -> str:
    """Canonical receipt quantity display — the single shared rule for both
    the text-mode formatter and the raster renderer (receipt_raster.py).
    Order.quantity is stored as Numeric(x,3) ("1.000"), which must never
    print as "1.000" for a whole count, but a genuine fraction must never be
    rounded away: 1 -> "1", 1.500 -> "1.5", 1.250 -> "1.25". Strips only
    trailing zeroes (and a bare trailing '.'), never casts to int."""
    d = qty if isinstance(qty, Decimal) else Decimal(str(qty))
    s = format(d, "f")  # fixed-point, never scientific notation
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s or "0"


def format_order_type(value) -> str:
    """На чеке всегда тот тип, что выбран при заказе — неизвестные значения
    печатаются как есть, строка типа не должна пропадать."""
    text = str(value or "").strip()
    return ORDER_TYPE_LABELS.get(text, text)


def derive_service_rate_percent(fee, base) -> Decimal | None:
    """Ставка сбора из застывших цифр заказа (сумма сбора ÷ база).
    База и сумма зафиксированы в день продажи — перепечатка позже покажет
    ставку дня продажи, а не текущую из настроек. None = скрыть %."""
    try:
        fee_d = Decimal(str(fee or 0))
        base_d = Decimal(str(base or 0))
    except Exception:
        return None
    if fee_d <= 0 or base_d <= 0:
        return None
    rate = (fee_d * 100 / base_d).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if rate <= 0:
        return None
    return rate


def format_rate_percent(value) -> str:
    """20 → "20", 10.50 → "10.5" — для подписи «Обслуживание 20%:»."""
    try:
        quantized = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception:
        return ""
    if quantized <= 0:
        return ""
    return format(quantized.normalize(), "f")


@dataclass
class ReceiptLine:
    name: str
    qty: Decimal
    price: Decimal
    total: Decimal
    modifiers: list[str] = field(default_factory=list)
    product_id: str | None = None
    note: str | None = None
    course: int = 1
    takeaway: bool = False
    # CANCEL-COMMENT-01: причина отмены блюда. Печатается в чеке ВСЕГДА —
    # отдельной строкой «Отменено: <блюдо> — <причина>».
    cancel_reason: str | None = None


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
    payment_method: str | None
    cash_received: Decimal | None = None
    change_given: Decimal | None = None
    table_number: str | None = None
    customer_name: str | None = None
    fiscal_code: str | None = None
    service_fee: Decimal = Decimal("0")
    # Ставка сбора в процентах (напр. 20) — для подписи «Обслуживание 20%:».
    # Вычисляется из застывших цифр заказа (derive_service_rate_percent),
    # None = показать сумму без % (старые заказы, неизвестная ставка).
    service_fee_rate: Decimal | None = None
    waiter_name: str | None = None
    printed_at: datetime = field(default_factory=datetime.now)
    staff_label: str = "Официант"
    receipt_staff: list[dict[str, str]] = field(default_factory=list)
    # Отменённые позиции с причиной: печатаются в чеке всегда (гость должен
    # видеть, что блюдо отменено и почему). Пустой список — ничего не печатаем.
    cancelled: list[ReceiptLine] = field(default_factory=list)
    customer_phone: str | None = None
    customer_address: str | None = None

    def delivery_contacts(self) -> list[str]:
        if self.order_type != "delivery":
            return []
        return [str(value).strip() for value in (self.customer_address, self.customer_phone) if value and str(value).strip()]


@dataclass
class KitchenItem:
    name: str
    qty: str
    modifiers: list[str] = field(default_factory=list)
    note: str | None = None
    course: int = 1
    # Real per-item amount (OrderItem.total). None when unknown — showOrderSum
    # must never fabricate a price, so a missing total simply prints nothing.
    total: Decimal | None = None
    product_id: str | None = None
    takeaway: bool = False


@dataclass
class KitchenTicketData:
    order_number: str
    order_type: str
    table_number: str | None
    waiter_name: str | None
    items: list[KitchenItem]
    note: str | None = None
    # new | accepted | cooking | ready | completed | cancelled (Order.status,
    # the canonical signal — see IS_CANCELLED_ORDER in the module docstring
    # above format_kitchen_ticket).
    status: str = "new"
    printed_at: datetime = field(default_factory=datetime.now)
    staff_label: str = "Официант"
    # "new" — обычный тикет; "item_cancel" — отмена блюд в живом заказе: вместо
    # строки типа заказа печатается «ОТМЕНА БЛЮДА», остальное без изменений.
    kind: str = "new"


KITCHEN_ITEM_CANCEL_LABEL = "ОТМЕНА БЛЮДА"


class EscPosFormatter:
    """
    Generates ESC/POS byte sequences for thermal printers.
    Works without a physical printer — output is bytes.
    """

    ESC = b"\x1b"
    GS  = b"\x1d"
    LF  = b"\x0a"
    CUT = b"\x1d\x56\x41\x03"   # partial cut
    # Request the extra footer in the feed-and-cut command itself. A separate
    # ESC J feed did not visibly change the cut position on the deployed printer.
    # Keep ~70% of the removed footer: 70 extra vertical motion units.
    KITCHEN_CUT = b"\x1d\x56\x41\x49"  # original n=3 + extra 70

    BOLD_ON     = ESC + b"\x45\x01"
    BOLD_OFF    = ESC + b"\x45\x00"
    ALIGN_LEFT  = ESC + b"\x61\x00"
    ALIGN_CENTER = ESC + b"\x61\x01"
    ALIGN_RIGHT = ESC + b"\x61\x02"
    DOUBLE_HEIGHT = GS + b"\x21\x01"
    NORMAL_SIZE   = GS + b"\x21\x00"
    INIT          = ESC + b"\x40"
    # ESC M n — select character font (n=0 Font A, n=1 Font B). GS!n (size)
    # only multiplies whatever font is CURRENTLY selected — it has no font-A/
    # B bit of its own. This formatter never issued ESC M at all, so "normal"
    # text silently inherited whatever font the printer's own state (NV
    # settings, or whatever the last job left behind — ESC @ does not
    # guarantee resetting it on every clone) happened to be in. On a printer
    # that defaults/drifts to the narrower, taller Font B, every "normal"
    # block reads as vertically stretched even though no size bits are set.
    # Forcing Font A explicitly — once at INIT and again after every styled
    # block — removes that dependency on inherited/ambient printer state.
    FONT_A        = ESC + b"\x4d\x00"

    # ESC 2 — restore the printer's own default line spacing (~30/180",
    # ≈4.2mm on a 180dpi thermal head). ESC 3 n — set spacing to n/180".
    # These are the calibrated ESC/POS density controls (near-universal on
    # ESC/POS clones), not ad-hoc extra feeds: small tightens, large opens
    # up, medium is simply "leave the printer's own default alone".
    LINE_SPACING_DEFAULT = ESC + b"\x32"
    _LINE_SPACING_CODES = {
        "small": ESC + b"\x33" + bytes([20]),
        "medium": LINE_SPACING_DEFAULT,
        "large": ESC + b"\x33" + bytes([40]),
    }

    # GS ! n — character size (bits 0-2: height x1-x8, bits 4-6: width x1-x8).
    # Width is never doubled here — see _style_bytes for why "xlarge" maps to
    # double-height rather than literal double-width+double-height.
    _ALIGN_CODES = {"left": ALIGN_LEFT, "center": ALIGN_CENTER, "right": ALIGN_RIGHT}

    # Соответствует умолчаниям frontend/src/api/receipt.js buildCustomerTemplate()
    # blockStyles — чтобы чек выглядел как превью в ReceiptSettingsPage даже до
    # того, как пользователь явно сохранит свои собственные стили блоков.
    # footerText больше не рендерится (см. format_receipt) — записи для него
    # тут нет; bottomOrderNumber — новый блок, дефолт зеркалит фронтенд.
    _DEFAULT_BLOCK_STYLES: dict[str, dict] = {
        "restaurantName": {"size": "large", "align": "center", "weight": "bold"},
        "address": {"align": "center"},
        "phone": {"align": "center"},
        "orderNumber": {"size": "standard", "align": "center", "weight": "bold"},
        "dateTime": {"size": "standard", "align": "center", "weight": "bold"},
        "total": {"size": "xlarge", "align": "left", "weight": "standard"},
        "thankYouText": {"size": "large", "align": "center", "weight": "bold"},
        "bottomOrderNumber": {"size": "large", "align": "center", "weight": "bold"},
    }

    # Chef defaults — mirrors CHEF_DEFAULT_BLOCK_STYLES in frontend/src/api/receipt.js.
    # Keys with no "align" entry are exactly the rows CHEF_STYLE_CONTROLS marks
    # align:false for — _kitchen_style() below forces those to "left" even if a
    # stray value is stored, matching "the frontend never exposed this control".
    _CHEF_DEFAULT_STYLES: dict[str, dict] = {
        "dishItems": {"size": "standard", "weight": "bold"},
        "orderNumber": {"size": "large", "align": "center", "weight": "bold"},
        "cancelOrderNumber": {"size": "large", "align": "center", "weight": "bold"},
        "orderType": {"size": "standard", "weight": "standard"},
        "table": {"size": "standard", "weight": "standard"},
        "waiter": {"size": "standard", "weight": "standard"},
        "date": {"size": "standard", "align": "left", "weight": "standard"},
        "showOrderSum": {"size": "standard", "weight": "standard"},
        "comment": {"size": "standard", "weight": "standard"},
    }
    # Rows the Chef constructor never gave an alignment control (CHEF_STYLE_CONTROLS
    # align:false) — orderNumber/cancelOrderNumber/date are the only ones with align:true.
    _CHEF_NO_ALIGN = {"orderType", "table", "waiter", "showOrderSum", "comment"}

    # Canonical block order + the two independent contracts (Customer / Chef).
    # Mirrors CUSTOMER_BLOCKS / KITCHEN_BLOCKS in frontend/src/api/receipt.js.
    CUSTOMER_BLOCKS = [
        "logo", "restaurantName", "address", "phone", "orderNumber", "table",
        "waiter", "dateTime", "items", "discount", "serviceFee", "vat", "total",
        "paymentMethod", "thankYouText", "bottomOrderNumber",
    ]
    KITCHEN_BLOCKS = [
        "orderType", "orderNumber", "cancelOrderNumber", "table", "waiter",
        "date", "showOrderSum", "comment",
    ]

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
        # 80mm ≈ 48 chars; 58mm ≈ 32 chars. This (Printer.paper_width, the
        # per-printer row) is the ONLY physical paper-width source — a
        # template's stored paperSize is a settings-preview convenience and
        # is never read here (see the module docstring / PHYSICAL_PAPER_WIDTH_SOURCE
        # in the handoff report).
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

    def _bold_line(self, text: str = "") -> bytes:
        """Like _line, but BOLD_ON/OFF wrap the text itself, before the LF —
        unlike a bare out.extend(self.BOLD_OFF) after a _line() call, this
        never leaves bold-off's control bytes dangling at the very start of
        whatever's printed next (the next _line()-built row, a _divider(),
        …), glued onto that line's content with no LF between them."""
        text = text.translate(self._CHAR_FALLBACKS)
        return self.BOLD_ON + text.encode(self._codec, errors="replace") + self.BOLD_OFF + self.LF

    def _multiline(self, text: str) -> bytes:
        out = bytearray()
        for line in str(text).split("\n"):
            out += self._line(line)
        return bytes(out)

    @staticmethod
    def _wrap(text: str | None, width: int) -> list[str]:
        """Word-wrap `text` to `width` characters — never truncates content.
        Splits on whitespace; a single word longer than `width` is hard-broken
        (rare: a URL/number with no spaces) so the loop always terminates.
        Operates on `str` (code points), so Cyrillic/Latin text is never cut
        mid-character even though the printer encoding is single-byte."""
        text = str(text or "").strip()
        if not text:
            return []
        if width <= 0:
            return [text]
        words = text.split()
        lines: list[str] = []
        cur = ""
        for word in words:
            while len(word) > width:
                if cur:
                    lines.append(cur)
                    cur = ""
                lines.append(word[:width])
                word = word[width:]
            candidate = f"{cur} {word}".strip()
            if len(candidate) <= width:
                cur = candidate
            else:
                if cur:
                    lines.append(cur)
                cur = word
        if cur:
            lines.append(cur)
        return lines

    def _wrapped_line(self, text: str, width: int) -> bytes:
        out = bytearray()
        for line in self._wrap(text, width) or [""]:
            out += self._line(line)
        return bytes(out)

    def _wrapped_centered(self, text: str, width: int | None = None) -> bytes:
        width = self.cols if width is None else width
        out = bytearray()
        out += self.ALIGN_CENTER
        out += self._wrapped_line(text, width)
        out += self.ALIGN_LEFT
        return bytes(out)

    def _logo_raster(self, logo_bytes: bytes) -> bytes | None:
        """Конвертирует произвольное растровое изображение (jpg/png/webp) в
        ESC/POS raster bit-image (GS v 0) — 1-бит монохром с дизерингом,
        вписанный по ширине бумаги (аспект сохраняется — resize по одной
        стороне, без обрезки и растяжения). Возвращает None, если Pillow не
        установлен или файл повреждён — печать чека не должна падать из-за
        картинки."""
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

    def _block_style(self, template: dict, key: str, defaults: dict | None = None) -> dict:
        """template['blockStyles'][key] (size/align/weight), см. ReceiptSectionEditor.
        Отсутствующие поля берутся из defaults (по умолчанию
        _DEFAULT_BLOCK_STYLES — те же дефолты, что показывает превью на фронте),
        а не просто 'standard' — иначе чек без явно сохранённых стилей
        выглядел бы монотонным, не как в превью. Кухонный тикет использует
        отдельный метод _kitchen_style() (ниже) со своими дефолтами
        (_CHEF_DEFAULT_STYLES), а не этот метод — у шефа и клиента разные
        дефолтные стили для orderNumber."""
        if defaults is None:
            defaults = self._DEFAULT_BLOCK_STYLES
        styles = template.get("blockStyles") or {}
        merged = {**defaults.get(key, {}), **(styles.get(key) or {})}
        # Contact blocks have no alignment control. Older templates contain
        # the generic hidden "left" default; do not let it override centering.
        if key in {"address", "phone"}:
            merged["align"] = "center"
        return merged

    def _kitchen_style(self, template: dict, key: str) -> dict:
        """Аналог _block_style для чек-повара: свои дефолты (CHEF_DEFAULT_BLOCK_STYLES)
        + нормализация устаревшего размера 'medium' → 'large' (Chef-редактор
        больше не предлагает 'medium', но старые сохранённые шаблоны могут его
        содержать — normalizeChefSize на фронте) + принудительный align='left'
        для строк, где конструктор никогда не показывал контрол выравнивания
        (CHEF_STYLE_CONTROLS align:false) — даже если в блобе завалялось чужое
        значение, оно не должно всплыть в физической печати."""
        styles = template.get("blockStyles") or {}
        merged = {**self._CHEF_DEFAULT_STYLES.get(key, {}), **(styles.get(key) or {})}
        if merged.get("size") == "medium":
            merged["size"] = "large"
        if key in self._CHEF_NO_ALIGN:
            merged["align"] = "left"
        return merged

    def _style_bytes(self, style: dict, *, size_code: int | None = None) -> tuple[bytes, bytes, int]:
        """(prefix, suffix, width_divisor) для набора style — GS!/ESC E/ESC a.
        width_divisor=1: размер меняет высоту, но не ширину символов.
        suffix ВСЕГДА возвращает align/bold/size к дефолту (ESC/POS не имеет
        стека состояний — если не сбросить явно, следующий ничем не
        стилизованный блок унаследует это форматирование)."""
        align = style.get("align", "left")
        weight = style.get("weight", "standard")
        size = style.get("size", "standard")

        # Physical "xlarge" is deliberately NOT ESC/POS double-width+double-height
        # (GS!0x11). The frontend's "xlarge" is a ~1.47x visual scale on a
        # proportional screen font; printing it as literal 2x2 on a monospace
        # thermal head makes a grand total disproportionately huge relative to
        # everything else on the receipt, and halving the usable column count
        # (cols//2) risks squeezing a long total/currency string. The nearest
        # fallback treatment: xlarge = double-HEIGHT only (same bits as
        # "large"). Weight is independent of size and follows the template.
        # Width is never halved for any size tier.
        #
        # "xxlarge" (только для bottomOrderNumber и коротких строк) — реальный
        # 2x2: double-width + double-height. cols делится на 2.
        bold = weight == "bold"
        if size_code is None:
            size_code = {"standard": 0x00, "large": 0x01, "xlarge": 0x01, "xxlarge": 0x11}.get(size, 0x00)
        width_divisor = (size_code >> 4) + 1

        # Font A is asserted explicitly on every block (not only when a size
        # is set) — GS!n only multiplies whatever font is currently active,
        # it has no font-A/B bit of its own, so a block must never depend on
        # a previous block (or the printer's own ambient/NV state) having
        # left Font A selected.
        prefix = bytearray()
        prefix += self.FONT_A
        prefix += self._ALIGN_CODES.get(align, self.ALIGN_LEFT)
        if size_code:
            prefix += self.GS + b"\x21" + bytes([size_code])
        if bold:
            prefix += self.BOLD_ON

        suffix = bytearray()
        if bold:
            suffix += self.BOLD_OFF
        if size_code:
            suffix += self.NORMAL_SIZE
        suffix += self.FONT_A
        suffix += self.ALIGN_LEFT

        return bytes(prefix), bytes(suffix), width_divisor

    def _styled_line(self, template: dict, key: str, text: str) -> bytes:
        """Многострочный (возможно, длинный — переносится по словам) текст
        (thankYouText/название заведения/...) с учётом стиля блока key."""
        style = self._block_style(template, key)
        size_code = {"standard": 0x00, "large": 0x11, "xlarge": 0x22}.get(style.get("size", "large")) if key == "restaurantName" else None
        prefix, suffix, div = self._style_bytes(style, size_code=size_code)
        width = self.cols // div
        wrapped = "\n".join(
            line for para in str(text).split("\n") for line in (self._wrap(para, width) or [""])
        )
        return prefix + self._multiline(wrapped) + suffix

    def _info_row(self, template: dict, key: str, label: str, value: str) -> bytes:
        """label-left / value-right-aligned info row, styled per
        blockStyles[key] (size/align/weight) — the physical counterpart of
        ReceiptPreview.jsx's infoRow() (CSS: label bold, value
        `text-align:right`, laid out as two columns — see
        .receipt-preview__info-row b / span in receiptSettings.css). Several
        customer-receipt rows (both "Номер заказа:" and "Тип заказа:" for the
        orderNumber block) can share one style key. A value too long to share
        the row wraps onto its own right-aligned continuation line(s) rather
        than overflowing the row width."""
        style = self._block_style(template, key)
        prefix, suffix, div = self._style_bytes(style)
        width = self.cols // div
        value = str(value)
        if len(label) + 1 + len(value) <= width:
            body = self._two_col(label, value, cols=width)
        else:
            body = bytearray()
            body.extend(self._line(label))
            for line in self._wrap(value, width) or [""]:
                body.extend(self._two_col("", line, cols=width))
            body = bytes(body)
        return prefix + body + suffix

    def _styled_row(self, template: dict, key: str, text: str, defaults: dict | None = None) -> bytes:
        """Одна строка с учётом стиля блока key. Текст обрезается под
        доступную ширину с учётом размера (xlarge съедает половину колонок)."""
        prefix, suffix, div = self._style_bytes(self._block_style(template, key, defaults))
        return prefix + self._line(str(text)[: self.cols // div]) + suffix

    def _divider(self, char: str = "-", cols: int | None = None) -> bytes:
        cols = self.cols if cols is None else cols
        separator = getattr(self, "_receipt_separator", None)
        if separator is not None:
            pattern, weight = separator
            char = {"dashed": "-", "solid": "_", "stars": "*"}[pattern]
            # Text-only fallback: repeated rules represent the three ink levels.
            return self._line(char * cols) * {"thin": 1, "medium": 2, "bold": 3}[weight]
        return self._line(char * cols)

    def _two_col(self, left: str, right: str, cols: int | None = None) -> bytes:
        cols = self.cols if cols is None else cols
        pad = cols - len(left) - len(right)
        return self._line(left + " " * max(pad, 1) + right)

    # Fixed column budget for the qty/amount pair on an item row — the name
    # column takes whatever is left. See _item_row for the narrow-paper switch.
    _ITEM_QTY_W = 6
    _ITEM_TOTAL_W = 10
    # Kitchen-ticket-only: wider Кол-во field when there's no Сумма column
    # to share the row with (see format_kitchen_ticket).
    _KITCHEN_QTY_W_PLAIN = 8

    def _three_col(self, name: str, qty: str, total: str, cols: int | None = None) -> bytes:
        """Header/labels row (short fixed strings) — no wrapping needed."""
        cols = self.cols if cols is None else cols
        name_w = max(cols - self._ITEM_QTY_W - self._ITEM_TOTAL_W, 1)
        name_trunc = name[:name_w].ljust(name_w)
        return self._line(name_trunc + qty.rjust(self._ITEM_QTY_W) + total.rjust(self._ITEM_TOTAL_W))

    def _item_row(self, name: str, qty: str, total: str, cols: int | None = None) -> bytes:
        """One dish row. Never truncates the name — either wraps it in the
        qty/total row's own column budget, or (when that budget is too narrow
        to hold BOTH the name and the numbers — narrow paper + 'xlarge' style)
        switches to the name-alone-then-'x{qty} … {total}' two-line layout, so
        the dish name column is never squeezed to zero width."""
        cols = self.cols if cols is None else cols
        qty_w, total_w = self._ITEM_QTY_W, self._ITEM_TOTAL_W
        if cols < qty_w + total_w + 4:
            out = bytearray()
            out += self._wrapped_line(name, cols)
            out += self._two_col(f"x{qty}", total, cols=cols)
            return bytes(out)
        name_w = cols - qty_w - total_w
        lines = self._wrap(name, name_w) or [""]
        out = bytearray()
        out += self._line(lines[0].ljust(name_w) + qty.rjust(qty_w) + total.rjust(total_w))
        for cont in lines[1:]:
            out += self._line(cont.ljust(name_w) + " " * (qty_w + total_w))
        return bytes(out)

    def _kitchen_item_row(
        self, name: str, qty: str, total: str | None, qty_w: int, total_w: int, cols: int | None = None, bold: bool = True
    ) -> bytes:
        """One kitchen-ticket dish row (bold, per format_kitchen_ticket's
        'always a table' layout): Кол-во centered — unlike _item_row's
        right-aligned receipt column — and Сумма only present when `total`
        is given (showOrderSum). Like _item_row, never truncates the name:
        wraps it across continuation lines, or (narrow paper) falls back to
        name-alone-then-numbers, so long dish/modifier text is never lost."""
        cols = self.cols if cols is None else cols
        line = self._bold_line if bold else self._line
        used = qty_w + (total_w if total is not None else 0)
        tail = qty.center(qty_w) + (total.rjust(total_w) if total is not None else "")
        if cols < used + 4:
            out = bytearray()
            out += self._wrapped_line(name, cols)
            out += line(tail)
            return bytes(out)
        name_w = cols - used
        lines = self._wrap(name, name_w) or [""]
        out = bytearray()
        out += line(lines[0].ljust(name_w) + tail)
        for cont in lines[1:]:
            out += line(cont.ljust(name_w) + " " * used)
        return bytes(out)

    def format_receipt(self, data: ReceiptData, template: dict | None = None, logo_bytes: bytes | None = None) -> bytes:
        """template — сохранённый с фронта шаблон (см. frontend/src/api/receipt.js,
        buildCustomerTemplate()): порядок блоков (template['blocks']), какие
        блоки включены (template['enabled']), подписи (thankYouText/
        restaurantName/address/phone), стили (blockStyles), плотность строк
        (lineSpacing). Без шаблона (ещё не настроен) печатаем все блоки в
        каноническом порядке — прежнее поведение.

        logo_bytes — сырые байты загруженного лого компании (jpg/png/webp),
        печатается растром (GS v 0), если блок 'logo' включён и лого
        загружено. QR намеренно не печатается с этого принтера — печатается
        отдельным QR-принтером вне этого проекта (см. PENDING_BLOCKS.qr во
        frontend/src/components/receipt/receiptBlockCapabilities.js), блок
        'qr' здесь не реализован и не входит в CUSTOMER_BLOCKS.

        footerText — устаревшее поле (до redesign'а receipt-density-tune-v1).
        Сохранённое значение НЕ трогаем (PATCH-схема — свободный blob), но
        больше не печатаем: заменено на bottomOrderNumber + thankYouText
        (переименован в UI в «Комментарий к чеку», ключ в блобе тот же)."""
        template = template or {}
        data = replace(data, items=grouped_items(data.items))
        self._receipt_separator = separator_style(template)
        en = lambda key, default=True: self._enabled(template, key, default)  # noqa: E731

        out = bytearray()
        out += self.INIT
        out += self.FONT_A
        out += self.codepage_cmd
        out += self._LINE_SPACING_CODES.get(str(template.get("lineSpacing") or "large").lower(), self._LINE_SPACING_CODES["large"])

        order_type_label = format_order_type(data.order_type)
        payment_label = PAYMENT_METHOD_LABELS.get(data.payment_method, data.payment_method)

        # Exact port of ReceiptPreview.jsx's run-building algorithm: walk
        # template.blocks in order, and for each block that actually renders
        # something, push its bytes into "runs" — a contiguous same-section
        # block extends the current run, a different section starts a new
        # one. This (not a fixed 5-group scheme) is what the frontend does,
        # and it matters here: in the CANONICAL default order, "address"/
        # "phone" sit right after "restaurantName" but belong to the FOOTER
        # section (see CUSTOMER_BLOCKS in frontend/src/api/receipt.js vs.
        # their push("footer", …) calls in ReceiptPreview.jsx) — so a default,
        # unmodified template legitimately produces TWO separate footer runs
        # (address/phone right under the header, then thankYouText/
        # bottomOrderNumber at the very end), not one merged block. A fixed
        # "5 groups, each rendered once" scheme (the previous approach here)
        # cannot represent that and silently duplicated footer content.
        ordered_blocks = self._customer_blocks(template)
        number_at_top = self._number_at_top(template)
        runs: list[list[bytes | bytearray]] = []  # each entry: [section, *chunks]

        def push(section: str, chunk: bytes | bytearray) -> None:
            if not chunk:
                return
            if runs and runs[-1][0] == section:
                runs[-1].append(chunk)
            else:
                runs.append([section, chunk])

        def render_summary() -> bytes:
            # Labels (mostly) match ReceiptPreview.jsx's summaryRow() calls —
            # "Сумма блюд"/"Скидка"/"Налог" carry no colon there, and "Налог"
            # never shows a percentage (that was this formatter's own
            # invention, not part of the accepted contract). "Обслуживание"
            # is the one deliberate exception on the PHYSICAL print only: the
            # frontend preview shows a generic "Обслуживание %" (no real
            # number — it has no real order to compute one from), but here
            # we have the actual rate (service_fee_rate — the % of the
            # place/hall this order's service fee was computed from, see
            # pos/service.py::_effective_service_rate) and print it exactly,
            # with the trailing colon the preview's generic label doesn't need.
            buf = bytearray()
            if data.subtotal > 0:
                buf.extend(self._two_col("Сумма блюд", f"{data.subtotal:,.0f}"))
            if en("discount") and data.discount > 0:
                buf.extend(self._two_col("Скидка", f"-{data.discount:,.0f}"))
            if en("serviceFee") and getattr(data, "service_fee", 0) and data.service_fee > 0:
                rate_label = format_rate_percent(data.service_fee_rate) if getattr(data, "service_fee_rate", None) else ""
                service_label = f"Обслуга {rate_label}%" if rate_label else "Обслуга"
                buf.extend(self._two_col(service_label, f"{data.service_fee:,.0f}"))
            if en("vat") and data.tax > 0:
                buf.extend(self._two_col("Налог", f"{data.tax:,.0f}"))
            return bytes(buf)

        summary_done = False
        if not en("restaurantName"):
            for contact in data.delivery_contacts():
                push("header", self._wrapped_centered(contact))
        for block in ordered_blocks:
            # The subtotal/discount/service/vat unit renders once, anchored
            # to "total" — matches ReceiptPreview.jsx exactly (it `continue`s
            # on these three regardless of blocks[] order or enabled state).
            if block in ("discount", "serviceFee", "vat"):
                continue
            if block == "total":
                push("financial", render_summary())
                summary_done = True
                # enabled.total must be truthful: the frontend can disable
                # just the grand-total line while keeping the summary above
                # it (isOn(enabled, "total")) — the physical print must honor
                # that, not print "Итого к оплате:" unconditionally.
                if en("total"):
                    total_style = self._block_style(template, "total")
                    total_prefix, total_suffix, total_div = self._style_bytes(total_style)
                    line = total_prefix + self._two_col("Итого:", f"{data.total:,.0f}", cols=self.cols // total_div) + total_suffix
                    push("financial", line)
                continue
            if not en(block):
                continue
            if block == "logo":
                if logo_bytes:
                    raster = self._logo_raster(logo_bytes)
                    if raster:
                        chunk = bytearray()
                        chunk.extend(self.ALIGN_CENTER)
                        chunk.extend(raster)
                        chunk.extend(self.LF)
                        chunk.extend(self.ALIGN_LEFT)
                        push("header", chunk)
            elif block == "restaurantName":
                # Branch name is NOT part of the accepted contract —
                # ReceiptPreview.jsx's "restaurantName" block renders only
                # {restaurantName}, nothing else; there is no separate
                # branch-name element anywhere in CustomerReceipt.
                name = str(template.get("restaurantName") or data.company_name)
                push("header", self._styled_line(template, "restaurantName", name))
                for contact in data.delivery_contacts():
                    push("header", self._wrapped_centered(contact))
            elif block == "orderNumber":
                # Two separate rows (same style), matching ReceiptPreview.jsx:
                # infoRow("orderNumber", "Номер заказа:", …) and
                # infoRow("orderNumber", "Тип заказа:", …) — not one combined
                # "Заказ #N  <type>" row.
                if not number_at_top:
                    push("info", self._info_row(template, "orderNumber", "Номер заказа:", str(data.order_number)))
                push("info", self._info_row(template, "orderNumber", "Тип заказа:", order_type_label))
            elif block == "table" and data.table_number:
                push("info", self._info_row(template, "table", "Номер стола:", str(data.table_number)))
            elif block == "waiter" and (data.waiter_name or data.cashier_name):
                staff = data.receipt_staff or [{"label": data.staff_label, "name": data.waiter_name or data.cashier_name}]
                for person in staff:
                    push("info", self._info_row(template, "waiter", f"{person['label']}:", person["name"]))
            elif block == "dateTime":
                # Order creation time (data.printed_at is set to it by
                # PrinterService), no seconds — matches formatCustomerDate().
                push("info", self._info_row(template, "dateTime", "Дата:", data.printed_at.strftime("%d.%m.%y %H:%M")))
                # data.customer_name (delivery name) has no CUSTOMER_BLOCKS key
                # yet — kept unconditional, directly after order info, pending
                # a template key (PENDING_BLOCKS.deliveryAddress/Phone upstream).
                if data.customer_name:
                    push("info", self._line(f"Клиент: {data.customer_name}"))
            elif block == "items":
                style = self._block_style(template, "items")
                prefix, suffix, div = self._style_bytes(style)
                cols = self.cols // div
                # Header is always bold; a style-level bold (prefix already
                # sent BOLD_ON) must stay on through the item rows below it —
                # an unconditional BOLD_OFF here would cancel that outer
                # state (ESC/POS bold is a toggle, not scoped to this call).
                block_bold = style.get("weight") == "bold"
                chunk = bytearray()
                chunk.extend(prefix)
                chunk.extend(self.BOLD_ON)
                chunk.extend(self._three_col("Блюдо", "Кол-во", "Сумма", cols=cols))
                if not block_bold:
                    chunk.extend(self.BOLD_OFF)
                chunk.extend(self._divider(cols=cols))
                for item in data.items:
                    chunk.extend(self._item_row(item.name, format_quantity(item.qty), f"{item.total:,.0f}", cols=cols))
                    for mod in item.modifiers:
                        chunk.extend(self._wrapped_line(f"  + {mod}", cols))
                    # Комментарий к блюду печатаем ВСЕГДА (а не только когда в
                    # шаблоне включён блок «Комментарий»): пожелание гостя —
                    # часть заказа, без него чек не читается.
                    if getattr(item, "note", None):
                        chunk.extend(self._wrapped_line(f"  * {item.note}", cols))
                # Отменённые блюда — с причиной отмены (возврат денег гостю).
                for item in (getattr(data, "cancelled", None) or []):
                    reason = f" — {item.cancel_reason}" if item.cancel_reason else ""
                    chunk.extend(self._wrapped_line(f"  x {item.name}{reason}", cols))
                if block_bold:
                    chunk.extend(self.BOLD_OFF)
                chunk.extend(suffix)
                push("items", chunk)
            elif block == "paymentMethod" and data.payment_method:
                # Matches ReceiptPreview.jsx's getPaymentRows(): an order with
                # no payment yet (data.payment_method is None) renders no row
                # at all, never a placeholder dash — a pre-bill for an unpaid
                # order must not fabricate a payment line. The row shows the
                # method AND the amount ("{label}: {amount}"), mirroring
                # PaymentRows' single fallback row (label=payment method,
                # amount=order total) rather than a bare method name.
                pay_style = self._block_style(template, "paymentMethod")
                pay_prefix, pay_suffix, pay_div = self._style_bytes(pay_style)
                pay_cols = self.cols // pay_div
                chunk = bytearray()
                chunk.extend(pay_prefix)
                chunk.extend(self._two_col(f"{payment_label}:", f"{data.total:,.0f}", cols=pay_cols))
                if data.cash_received is not None:
                    chunk.extend(self._two_col("Получено:", f"{data.cash_received:,.0f}", cols=pay_cols))
                    chunk.extend(self._two_col("Сдача:", f"{data.change_given or 0:,.0f}", cols=pay_cols))
                chunk.extend(pay_suffix)
                push("financial", chunk)
            elif block == "thankYouText":
                # Default text matches ReceiptPreview.jsx's own fallback
                # exactly ("XARIDINGIZ\nUCHUN RAXMAT!", two lines, not a
                # Russian default) — an unsaved template renders this literal
                # fallback in both places.
                push("footer", self._styled_line(template, "thankYouText", template.get("thankYouText") or "XARIDINGIZ\nUCHUN RAXMAT!"))
            elif block == "bottomOrderNumber":
                style = self._block_style(template, "bottomOrderNumber")
                size_code = {"standard": 0x11, "large": 0x22, "xlarge": 0x55, "xxlarge": 0x66}.get(style.get("size", "large"), 0x22)
                prefix, suffix, div = self._style_bytes(style, size_code=size_code)
                width = self.cols // div
                chunk = bytearray()
                # Визуальное выделение: пустые строки до и после
                chunk.extend(self._line(""))
                chunk.extend(prefix)
                # Только номер, без подписи "НОМЕР ЗАКАЗА" — иначе подпись
                # мелкая и отвлекает от самого номера.
                chunk.extend(self._wrapped_line(str(data.order_number), width))
                chunk.extend(suffix)
                chunk.extend(self._line(""))
                push("header" if number_at_top else "footer", chunk)
            elif block == "address":
                address = template.get("address")
                if address:
                    push("footer", self._wrapped_centered(str(address)))
            elif block == "phone":
                phone = template.get("phone")
                if phone:
                    push("footer", self._wrapped_centered(str(phone)))
        if not summary_done:
            push("financial", render_summary())  # total block missing from a legacy template
        if data.fiscal_code:
            fiscal_chunk = self._divider() + self._wrapped_centered(f"ФН: {data.fiscal_code}")
            push("financial", fiscal_chunk)

        # No rule directly under the brand header (frozen preview:
        # boundaryRule returns null when the previous run was "header").
        last_section: str | None = None
        for run in runs:
            section = run[0]
            if last_section is not None and last_section != "header":
                out.extend(self._divider())
            for chunk in run[1:]:
                out.extend(chunk)
            last_section = section

        out.extend(self.LF * 3)
        out.extend(self.CUT)

        return bytes(out)

    @staticmethod
    def _number_at_top(template: dict) -> bool:
        return (EscPosFormatter._enabled(template, "bottomOrderNumber")
                and (template.get("blockStyles") or {}).get("bottomOrderNumber", {}).get("placement") == "top")

    def _customer_blocks(self, template: dict) -> list[str]:
        blocks = self._ordered(template.get("blocks"), self.CUSTOMER_BLOCKS)
        if self._number_at_top(template):
            blocks.remove("bottomOrderNumber")
            blocks.insert(blocks.index("restaurantName") + 1, "bottomOrderNumber")
        return blocks

    @staticmethod
    def _ordered(blocks: object, canonical: list[str]) -> list[str]:
        """Port of frontend/src/pages/settings/receiptBlockOrder.js::orderedBlocks —
        the single source of block order shared by the editor, the live preview
        and (here) the physical formatter. Keeps only known keys from the saved
        order, in that order, then appends any canonical block missing from it
        (a partial/legacy template never loses a known block); unknown keys from
        a future frontend version are silently ignored."""
        known = set(canonical)
        seen: set[str] = set()
        result: list[str] = []
        if isinstance(blocks, list):
            for block in blocks:
                if block in known and block not in seen:
                    result.append(block)
                    seen.add(block)
        for block in canonical:
            if block not in seen:
                result.append(block)
        return result

    @classmethod
    def _ordered_kitchen(cls, stored) -> list[str]:
        # Type is a standalone heading above the number, including old templates.
        return ["orderType", *[b for b in cls._ordered(stored, cls.KITCHEN_BLOCKS) if b != "orderType"]]

    def format_kitchen_ticket(self, data: KitchenTicketData, template: dict | None = None) -> bytes:
        """template — см. frontend/src/api/receipt.js buildKitchenTemplate() /
        KITCHEN_BLOCKS (8-строчный конструктор): {blocks, enabled: {orderNumber,
        cancelOrderNumber, orderType, table, waiter, date, showOrderSum,
        comment}, blockStyles}. Без шаблона — печатаем все 8 блоков в
        каноническом порядке.

        IS_CANCELLED_ORDER — единственный канонический сигнал отмены:
        data.status == "cancelled" (Order.status; та же state machine, что
        app/modules/pos/service.py::VALID_TRANSITIONS использует как
        терминальное состояние). Не по образцу строк с фронта.

        Блюда/модификаторы — основное содержимое кухонного тикета: печатаются ВСЕГДА,
        вне зависимости от видимых тумблеров (их в KITCHEN_BLOCKS больше нет —
        legacy-ключи 'items'/'modifiers' сохраняются в блобе нетронутыми, но
        физическую печать больше не определяют). 'comment' — единый тумблер
        для комментариев к позиции (бывший itemComments) И комментария к
        заказу (бывший orderNote). 'showOrderSum' — только реальная сумма
        позиции (OrderItem.total), никогда не выдуманная. 'priority' (баннер
        "! СРОЧНО !") — удалён из физической печати; устаревшее значение в
        блобе сохраняется, но игнорируется.

        Legacy-ключи: шаблон, сохранённый до появления 'comment', может нести
        только 'itemComments'/'orderNote' (см. выше) — учитываются, если
        'comment' в enabled отсутствует. Аналогично 'date' отсутствующий в
        enabled падает на устаревший 'createdAt' (en("date", en("createdAt",
        True))) — оба пути покрыты test_receipt_block_styles.py."""
        template = template or {}
        data = replace(data, items=grouped_items(data.items))
        self._receipt_separator = separator_style(template)
        en = lambda key, default=True: self._enabled(template, key, default)  # noqa: E731

        out = bytearray()
        out += self.INIT
        out += self.FONT_A
        out += self.codepage_cmd
        out += self._LINE_SPACING_CODES.get(str(template.get("lineSpacing") or "medium").lower(), self.LINE_SPACING_DEFAULT)

        cancelled = data.status == "cancelled"
        is_item_cancel = getattr(data, "kind", "new") == "item_cancel"
        show_cancel = cancelled and en("cancelOrderNumber", True)
        show_normal_number = (not show_cancel) and en("orderNumber", True)
        # 'comment' is the unified modern key for both item-level notes and
        # the order-level note; if a saved template predates it, each falls
        # back to its own legacy key (itemComments / orderNote respectively)
        # — 'comment', when present, always wins over either.
        item_comment_on = en("comment", en("itemComments", True))
        order_comment_on = en("comment", en("orderNote", True))
        show_money = en("showOrderSum", False)
        order_type_label = format_kitchen_order_type(data.order_type)

        def render_number_block() -> None:
            style = self._kitchen_style(template, "cancelOrderNumber" if show_cancel else "orderNumber")
            prefix, suffix, div = self._style_bytes(style)
            width = self.cols // div
            out.extend(prefix)
            out.extend(self._wrapped_line(f"#{data.order_number}", width))
            out.extend(suffix)
            if show_cancel:
                out.extend(self.ALIGN_CENTER + self.BOLD_ON)
                out.extend(self._line("ОТМЕНА"))
                out.extend(self.BOLD_OFF + self.ALIGN_LEFT)

        def render_row(block: str, label: str, value: str | None) -> bool:
            if not value:
                return False
            style = self._kitchen_style(template, block)
            prefix, suffix, div = self._style_bytes(style)
            out.extend(prefix)
            out.extend(self._wrapped_line(f"{label} {value}", self.cols // div))
            out.extend(suffix)
            return True

        any_info = False
        for block in self._ordered_kitchen(template.get("blocks")):
            if block in ("orderNumber", "cancelOrderNumber"):
                if block == "cancelOrderNumber" and show_cancel:
                    render_number_block()
                    any_info = True
                elif block == "orderNumber" and show_normal_number:
                    render_number_block()
                    any_info = True
            elif block == "orderType" and (is_item_cancel or en("orderType", True)):
                header_label = KITCHEN_ITEM_CANCEL_LABEL if is_item_cancel else order_type_label
                if header_label:
                    style = {**self._kitchen_style(template, "orderType"),
                             "align": self._kitchen_style(template, "orderNumber")["align"]}
                    if is_item_cancel:
                        style = {**style, "weight": "bold"}
                    prefix, suffix, div = self._style_bytes(style)
                    out.extend(prefix + self._wrapped_line(header_label, self.cols // div) + suffix)
                    any_info = True
            elif block == "table" and en("table", True):
                any_info = render_row("table", "Стол:", data.table_number) or any_info
            elif block == "waiter" and en("waiter", True):
                any_info = render_row("waiter", f"{data.staff_label}:", data.waiter_name) or any_info
            elif block == "date" and en("date", en("createdAt", True)):
                any_info = render_row("date", "Время:", data.printed_at.strftime("%d.%m.%y %H:%M")) or any_info
            # showOrderSum / comment are gates with no own printed position.

        if any_info:
            out.extend(self._divider("="))

        # Dishes: core content, always printed as a table (Блюдо/Кол-во
        # [+Сумма]) — Кол-во always dead-center in its own header-width field
        # (narrower, 6-wide, when showOrderSum adds the Сумма column; 8-wide
        # otherwise), never the receipt's right-edge _item_row alignment.
        # Modifiers follow regardless of sums; comments follow the unified
        # 'comment' toggle; amounts only via 'showOrderSum', and only when a
        # real total is known (never fabricated).
        qty_w = self._ITEM_QTY_W if show_money else self._KITCHEN_QTY_W_PLAIN
        total_w = self._ITEM_TOTAL_W
        name_w = self.cols - qty_w - (total_w if show_money else 0)
        head_prefix, head_suffix, _ = self._style_bytes({"size": "standard", "weight": "bold", "align": "left"})
        out.extend(head_prefix)
        if show_money:
            out.extend(self._line("Блюдо".ljust(name_w) + "Кол-во".center(qty_w) + "Сумма".rjust(total_w)))
        else:
            out.extend(self._line("Блюдо".ljust(name_w) + "Кол-во".center(qty_w)))
        out.extend(head_suffix)

        courses: dict[int, list[KitchenItem]] = {}
        for item in data.items:
            courses.setdefault(item.course or 1, []).append(item)
        for course_num in sorted(courses):
            if len(courses) > 1:
                out.extend(self._bold_line(f"--- Подача {course_num} ---"))
            for item in courses[course_num]:
                total_str = None
                if show_money and item.total is not None:
                    total_str = f"{item.total:,.0f}"
                item_prefix, item_suffix, _ = self._style_bytes(self._kitchen_style(template, "dishItems"))
                out.extend(item_prefix)
                item_row = self._kitchen_item_row(item.name, str(item.qty), total_str, qty_w, total_w, bold=False)
                # Reset before the row's final newline, never on the next divider.
                out.extend(item_row[:-1] + item_suffix + self.LF if item_row.endswith(self.LF) else item_row + item_suffix)
                for mod in item.modifiers:
                    out.extend(self._wrapped_line(f"  + {mod}", self.cols))
                if item_comment_on and item.note:
                    out.extend(self._wrapped_line(f"  ! {item.note}", self.cols))

        if order_comment_on and data.note:
            out.extend(self._divider())
            comment_prefix, comment_suffix, comment_div = self._style_bytes(self._kitchen_style(template, "comment"))
            out.extend(comment_prefix)
            out.extend(self._wrapped_line(f"КОММЕНТАРИЙ: {data.note}", self.cols // comment_div))
            out.extend(comment_suffix)

        out.extend(self._divider("="))
        # The divider ends its line; CUT advances to the knife itself.
        out.extend(self.KITCHEN_CUT)
        return bytes(out)


    def format_summary(
        self, title: str, lines: list[str], footer: str | None = None,
        printed_at: datetime | None = None,
    ) -> bytes:
        """Summary receipt (History/Reports): centered title, free-form lines, optional footer.

        ``printed_at`` is the company-local print moment; without it the
        server clock is used, which is UTC inside Docker and would put a
        report receipt five hours behind the terminal.
        """
        self._receipt_separator = None
        out = bytearray()
        out += self.INIT
        out += self.FONT_A
        out += self.codepage_cmd
        out += self.ALIGN_CENTER
        out += self.BOLD_ON + self.DOUBLE_HEIGHT
        out += self._line(title[: self.cols])
        out += self.NORMAL_SIZE + self.BOLD_OFF
        out += self._line((printed_at or datetime.now()).strftime("%d.%m.%Y %H:%M:%S"))
        out += self._divider()
        out += self.ALIGN_LEFT
        for ln in lines:
            out += self._line(ln[: self.cols])
        if footer:
            out += self._divider()
            out += self.BOLD_ON
            out += self._line(footer[: self.cols])
            out += self.BOLD_OFF
        out += self.LF * 3
        out += self.CUT
        return bytes(out)
