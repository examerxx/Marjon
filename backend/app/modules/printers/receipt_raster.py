"""
Raster (GS v 0 bitmap) customer-receipt renderer.

Physically approved on the real XPrinter as a replacement for text-mode
ESC/POS, which on that hardware produced narrow/vertically-stretched glyphs
regardless of ESC M (font select) — see docs/physical_receipt_parity_v1_report.md
and the V4 calibration pass for the investigation trail.

This module is a RENDERING backend only. It consumes the exact same
ReceiptData PrinterService._build_receipt_data() builds and the exact same
saved customer template EscPosFormatter.format_receipt() reads — no order,
payment, company or template queries live here, and no quantity/total/label
logic is reimplemented: everything content-shaped is read straight off
ReceiptData or borrowed from EscPosFormatter's own static/shared helpers
(_ordered, _enabled, _block_style, ORDER_TYPE_LABELS, PAYMENT_METHOD_LABELS,
format_quantity) so raster and text-mode can never silently drift apart on
what they print, only on how.
"""
from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field, replace
from app.modules.printers.receipt_layout import grouped_items, separator_style

from PIL import Image, ImageDraw, ImageFont, ImageOps

from app.modules.printers.formatter import (
    EscPosFormatter,
    KITCHEN_ITEM_CANCEL_LABEL,
    KitchenTicketData,
    ORDER_TYPE_LABELS,
    PAYMENT_METHOD_LABELS,
    ReceiptData,
    format_quantity,
    format_rate_percent,
    format_kitchen_order_type,
)

logger = logging.getLogger(__name__)


class RasterRenderError(Exception):
    """Raised only for failures before any bytes reach the printer — the
    one case PrinterService is allowed to catch and fall back to text-mode
    on. Never raised, and never meant to be caught, after print_raw()."""


# 12px/column — the same heuristic EscPosFormatter._logo_raster() already
# uses for the logo block, and what the physically-approved V4 proof used.
# 58mm is its own independent layout (own column budgets below), not a
# scaled-down 80mm bitmap — a scaled bitmap would just re-shrink glyphs back
# into the narrow/stretched territory this renderer exists to avoid.
_WIDTH_BY_MM = {80: 576, 58: 384}
_DEFAULT_WIDTH = 576
_MARGIN = 16

# Font candidates tried in order; first one that loads wins. Arial covers
# this dev machine (Windows); DejaVu/Liberation cover a Debian/Alpine
# container (neither is installed in backend/Dockerfile's python:3.12-slim
# today — see the integration report's "remaining work" note). No font file
# is bundled or exported by this module; these are system-path lookups only,
# and PIL's built-in bitmap font is the last-resort fallback so a missing
# TTF degrades quality rather than crashing mid-render.
_FONT_CANDIDATES = {
    "regular": [
        r"C:\Windows\Fonts\arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ],
    "bold": [
        r"C:\Windows\Fonts\arialbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ],
}
_SIZE_PT = {"standard": 24, "large": 32, "xlarge": 38}

_font_cache: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def _load_font(weight: str, size_pt: int) -> ImageFont.FreeTypeFont:
    key = (weight, size_pt)
    cached = _font_cache.get(key)
    if cached is not None:
        return cached
    for path in _FONT_CANDIDATES[weight]:
        try:
            font = ImageFont.truetype(path, size_pt)
            _font_cache[key] = font
            return font
        except OSError:
            continue
    try:
        font = ImageFont.load_default(size=size_pt)
    except TypeError:
        font = ImageFont.load_default()
    _font_cache[key] = font
    return font


@dataclass
class _Row:
    draw_fn: object  # Callable[[ImageDraw.ImageDraw, int, int], int] — (draw, y, width) -> next_y


class _RasterCanvas:
    """Accumulates draw callables, matching EscPosFormatter.format_receipt's
    own run/section model: a styled block is drawn, a plain divider between
    non-contiguous sections. Rendered lazily (a dry run with a 1x1 probe
    image measures total height) so the final bitmap is exactly as tall as
    its content, never padded."""

    def __init__(self, width_px: int, separator=None):
        self.width = width_px
        self.rows: list = []
        self.separator = separator

    def _append(self, fn) -> None:
        self.rows.append(fn)

    def image_row(self, img: Image.Image, gap_after: int) -> None:
        def _draw(draw, y):
            x = int((self.width - img.width) / 2)
            draw.bitmap((x, int(y)), ImageOps.invert(img.convert("L")), fill=0)
            return y + img.height + gap_after
        self._append(_draw)

    def divider(self, gap_before: int = 4, gap_after: int = 10) -> None:
        def _draw(draw, y):
            yy = y + gap_before
            pattern, weight = self.separator or ("solid", "thin")
            thickness = {"thin": 1, "medium": 2, "bold": 3}[weight]
            if pattern == "stars":
                font = _load_font("regular" if weight == "thin" else "bold", 24)
                width = self.width - 2 * _MARGIN
                count = max(1, int(width / max(1, draw.textlength("* ", font=font))))
                draw.text((_MARGIN, yy), "* " * count, font=font, fill=0, stroke_width=1 if weight == "bold" else 0)
                return yy + font.size + gap_after
            if pattern == "solid":
                draw.line([(_MARGIN, yy), (self.width - _MARGIN, yy)], fill=0, width=thickness)
            else:
                for x in range(_MARGIN, self.width - _MARGIN, 18):
                    draw.line([(x, yy), (min(x + 10, self.width - _MARGIN), yy)], fill=0, width=thickness)
            return yy + thickness + gap_after
        self._append(_draw)

    def text_row(self, label: str, value: str, font: ImageFont.FreeTypeFont, align: str, gap_after: int) -> None:
        """Label-left / value-right-aligned-to-the-margin — ALWAYS, regardless
        of `align`. This mirrors what the text-mode formatter's _two_col/
        _info_row actually produce physically: a full-width padded row, where
        an ESC/POS align command is visually inert because there is no
        narrower content to move. Treating blockStyle.align as "center the
        whole row" here would be a real behavioral difference from the
        approved (and text-mode) layout, not a style nicety — see the V1
        regression this fixed (info rows rendering centered, and a long
        "Итого к оплате:" value overflowing the 58mm margin when align="left"
        was read as "pack the value right after the label")."""
        def _draw(draw, y):
            if not value:
                draw.text((_MARGIN, y), label, font=font, fill=0)
                return y + font.size + gap_after
            avail = self.width - 2 * _MARGIN
            lw = draw.textlength(label, font=font)
            vw = draw.textlength(value, font=font)
            if lw + 12 + vw <= avail:
                draw.text((_MARGIN, y), label, font=font, fill=0)
                draw.text((self.width - _MARGIN - vw, y), value, font=font, fill=0)
                return y + font.size + gap_after
            # Doesn't fit on one line at this font size (narrow paper + a
            # large/xlarge style, e.g. "Итого к оплате:" at 58mm) — label on
            # its own line, value right-aligned on the next, same pattern
            # EscPosFormatter._item_row already uses for narrow+xlarge text-
            # mode rows, rather than letting the two overlap.
            draw.text((_MARGIN, y), label, font=font, fill=0)
            yy = y + font.size + 6
            draw.text((self.width - _MARGIN - vw, yy), value, font=font, fill=0)
            return yy + font.size + gap_after
        self._append(_draw)

    def line_of_text(self, text: str, font: ImageFont.FreeTypeFont, align: str, gap_after: int, bold_wrap_width: int | None = None) -> None:
        width = (bold_wrap_width or (self.width - 2 * _MARGIN))

        def _draw(draw, y):
            yy = y
            for chunk in _wrap(draw, text, font, width):
                if align == "center":
                    tw = draw.textlength(chunk, font=font)
                    draw.text(((self.width - tw) / 2, yy), chunk, font=font, fill=0)
                elif align == "right":
                    tw = draw.textlength(chunk, font=font)
                    draw.text((self.width - _MARGIN - tw, yy), chunk, font=font, fill=0)
                else:
                    draw.text((_MARGIN, yy), chunk, font=font, fill=0)
                yy += font.size + 6
            return yy - 6 + gap_after
        self._append(_draw)

    def item_row(self, name: str, qty: str, total: str, font: ImageFont.FreeTypeFont, qty_w: int, total_w: int, gap_after: int) -> None:
        name_w = self.width - 2 * _MARGIN - qty_w - total_w - 16

        def _draw(draw, y):
            lines = _wrap(draw, name, font, name_w) or [""]
            draw.text((_MARGIN, y), lines[0], font=font, fill=0)
            # qty is CENTER-aligned within its own column — both this row
            # and the header row (item_row("Блюдо", "Кол-во", "Сумма", ...))
            # share the exact same qty_col_x/qty_w, so the header's and
            # every value's center coincide by construction. Amount stays
            # right-aligned — only the quantity column's alignment changed.
            qty_col_x = self.width - _MARGIN - total_w - qty_w
            qw = draw.textlength(qty, font=font)
            draw.text((qty_col_x + (qty_w - qw) / 2, y), qty, font=font, fill=0)
            tw = draw.textlength(total, font=font)
            draw.text((self.width - _MARGIN - tw, y), total, font=font, fill=0)
            yy = y + font.size + 6
            for cont in lines[1:]:
                draw.text((_MARGIN, yy), cont, font=font, fill=0)
                yy += font.size + 6
            return yy - 6 + gap_after
        self._append(_draw)

    def render(self) -> Image.Image:
        probe = Image.new("L", (10, 10), 255)
        pdraw = ImageDraw.Draw(probe)
        y = _MARGIN
        for fn in self.rows:
            y = fn(pdraw, y)
        height = int(y + _MARGIN)

        img = Image.new("L", (self.width, max(height, 2 * _MARGIN)), 255)
        draw = ImageDraw.Draw(img)
        y = _MARGIN
        for fn in self.rows:
            y = fn(draw, y)
        return img


_probe_draw = ImageDraw.Draw(Image.new("L", (1, 1)))


def _measure(font: ImageFont.FreeTypeFont, text: str) -> int:
    return int(_probe_draw.textlength(text, font=font))


def _wrap(draw: "ImageDraw.ImageDraw", text: str, font: ImageFont.FreeTypeFont, max_w: int) -> list[str]:
    text = str(text or "").strip()
    if not text:
        return []
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        while draw.textlength(word, font=font) > max_w and len(word) > 1:
            # hard-break a single word wider than the row (rare: a long
            # unbroken token) so wrapping always terminates
            lo, hi = 1, len(word)
            while lo < hi:
                mid = (lo + hi + 1) // 2
                if draw.textlength(word[:mid], font=font) <= max_w:
                    lo = mid
                else:
                    hi = mid - 1
            if cur:
                lines.append(cur)
                cur = ""
            lines.append(word[:lo])
            word = word[lo:]
        candidate = f"{cur} {word}".strip()
        if draw.textlength(candidate, font=font) <= max_w:
            cur = candidate
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def _style(template: dict, helper: EscPosFormatter, key: str) -> dict:
    return helper._block_style(template, key)


def _font_for(template: dict, helper: EscPosFormatter, key: str) -> tuple[ImageFont.FreeTypeFont, str]:
    style = _style(template, helper, key)
    sizes = ({"standard": 48, "large": 96, "xlarge": 180, "xxlarge": 220} if key == "bottomOrderNumber"
             else {"standard": 32, "large": 48, "xlarge": 80} if key == "restaurantName" else _SIZE_PT)
    size = sizes.get(style.get("size", "standard"), sizes["standard"])
    weight = "bold" if style.get("weight") == "bold" else "regular"
    return _load_font(weight, size), style.get("align", "left")


def _kitchen_font_for(template: dict, helper: EscPosFormatter, key: str) -> tuple[ImageFont.FreeTypeFont, str]:
    """Same lookup as _font_for but through _kitchen_style (CHEF_DEFAULT_STYLES
    + the medium->large normalization + the forced-left no-align rows) — the
    Chef constructor's own defaults/contract, not the customer one's."""
    style = helper._kitchen_style(template, key)
    size = _SIZE_PT.get(style.get("size", "standard"), _SIZE_PT["standard"])
    weight = "bold" if style.get("weight") == "bold" else "regular"
    return _load_font(weight, size), style.get("align", "left")


def _prepare_logo(logo_bytes: bytes, max_width: int) -> Image.Image | None:
    try:
        src = Image.open(io.BytesIO(logo_bytes))
        if src.mode in ("RGBA", "LA") or (src.mode == "P" and "transparency" in src.info):
            base = Image.new("RGBA", src.size, (255, 255, 255, 255))
            base.alpha_composite(src.convert("RGBA"))
            src = base
        img = src.convert("L")
    except Exception as exc:  # noqa: BLE001 — a bad logo must never block the receipt
        logger.warning("RASTER_LOGO_DECODE_FAILED error=%s", exc)
        return None
    if img.width > max_width:
        img = img.resize((max_width, max(1, round(img.height * max_width / img.width))))
    return img.convert("1")


def render_customer_receipt_raster(data: ReceiptData, template: dict | None, paper_width_mm: int, logo_bytes: bytes | None = None) -> bytes:
    """Mirrors EscPosFormatter.format_receipt()'s own run-building algorithm
    (same block order, same enabled truth, same financial-summary anchoring,
    same payment truth, same thank-you default) but draws to a bitmap and
    ships it as one GS v 0 raster block instead of plain text rows. Returns
    the complete print payload (INIT + raster + feed + cut), a drop-in
    replacement for format_receipt()'s return value.

    Raises RasterRenderError for any failure during layout/rendering — the
    caller (PrinterService) is expected to catch only this and fall back to
    text-mode, and only when nothing has been sent to the printer yet."""
    try:
        template = template or {}
        data = replace(data, items=grouped_items(data.items))
        helper = EscPosFormatter(paper_width_mm)
        width_px = _WIDTH_BY_MM.get(paper_width_mm, _DEFAULT_WIDTH)
        spacing_mult = {"small": 0.7, "medium": 1.0, "large": 1.3}.get(
            str(template.get("lineSpacing") or "large").lower(), 1.3
        )

        def en(key: str, default: bool = True) -> bool:
            return EscPosFormatter._enabled(template, key, default)

        order_type_label = ORDER_TYPE_LABELS.get(data.order_type, data.order_type)
        payment_label = PAYMENT_METHOD_LABELS.get(data.payment_method, data.payment_method)

        canvas = _RasterCanvas(width_px, separator_style(template))
        ordered_blocks = helper._customer_blocks(template)
        number_at_top = helper._number_at_top(template)

        last_section: str | None = None

        def gap(base: int) -> int:
            return max(2, int(base * spacing_mult))

        def boundary(section: str) -> None:
            nonlocal last_section
            if last_section is not None and last_section != section and last_section != "header":
                canvas.divider(gap_before=0, gap_after=gap(10))
            last_section = section

        summary_done = False

        def render_summary() -> None:
            font, _ = _font_for(template, helper, "items")
            if data.subtotal > 0:
                boundary("financial")
                canvas.text_row("Сумма блюд", f"{data.subtotal:,.0f}", font, "left", gap(8))
            if en("discount") and data.discount > 0:
                boundary("financial")
                canvas.text_row("Скидка", f"-{data.discount:,.0f}", font, "left", gap(8))
            if en("serviceFee") and getattr(data, "service_fee", 0) and data.service_fee > 0:
                boundary("financial")
                # Ставка — из застывших цифр заказа (как в текстовом
                # форматтере): 0% обслуживания не печатается вообще, а при
                # ненулевой сумме гость видит и процент, и сумму.
                rate_label = format_rate_percent(data.service_fee_rate) if getattr(data, "service_fee_rate", None) else ""
                service_label = f"Обслуга {rate_label}%" if rate_label else "Обслуга"
                canvas.text_row(service_label, f"{data.service_fee:,.0f}", font, "left", gap(8))
            if en("vat") and data.tax > 0:
                boundary("financial")
                canvas.text_row("Налог", f"{data.tax:,.0f}", font, "left", gap(8))

        if not en("restaurantName"):
            for contact in data.delivery_contacts():
                boundary("header")
                canvas.line_of_text(contact, _load_font("regular", _SIZE_PT["standard"]), "center", gap(8))
        for block in ordered_blocks:
            if block in ("discount", "serviceFee", "vat"):
                continue
            if block == "total":
                render_summary()
                summary_done = True
                if en("total"):
                    boundary("financial")
                    font, align = _font_for(template, helper, "total")
                    canvas.text_row("Итого:", f"{data.total:,.0f}", font, align, gap(16))
                continue
            if not en(block):
                continue
            if block == "logo":
                if logo_bytes:
                    logo_img = _prepare_logo(logo_bytes, int(width_px * 0.6))
                    if logo_img is not None:
                        canvas.image_row(logo_img, gap(12))
            elif block == "restaurantName":
                boundary("header")
                font, align = _font_for(template, helper, "restaurantName")
                name = str(template.get("restaurantName") or data.company_name)
                canvas.line_of_text(name, font, align, gap(14))
                for contact in data.delivery_contacts():
                    canvas.line_of_text(contact, _load_font("regular", _SIZE_PT["standard"]), "center", gap(8))
            elif block == "orderNumber":
                boundary("info")
                font, align = _font_for(template, helper, "orderNumber")
                if not number_at_top:
                    canvas.text_row("Номер заказа:", str(data.order_number), font, align, gap(8))
                canvas.text_row("Тип заказа:", order_type_label, font, align, gap(8))
            elif block == "table" and data.table_number:
                boundary("info")
                font, align = _font_for(template, helper, "table")
                canvas.text_row("Номер стола:", str(data.table_number), font, align, gap(8))
            elif block == "waiter" and (data.waiter_name or data.cashier_name):
                boundary("info")
                font, align = _font_for(template, helper, "waiter")
                staff = data.receipt_staff or [{"label": data.staff_label, "name": data.waiter_name or data.cashier_name}]
                for person in staff:
                    canvas.text_row(f"{person['label']}:", person["name"], font, align, gap(8))
            elif block == "dateTime":
                boundary("info")
                font, align = _font_for(template, helper, "dateTime")
                canvas.text_row("Дата:", data.printed_at.strftime("%d.%m.%y %H:%M"), font, align, gap(8))
                if data.customer_name:
                    canvas.text_row("Клиент:", data.customer_name, font, align, gap(8))
            elif block == "items":
                boundary("items")
                font, _ = _font_for(template, helper, "items")
                header_font = _load_font("bold", font.size)
                # Column widths are measured, not guessed: a fixed pixel
                # budget tuned for 80mm collided with "Кол-во"/"Сумма" at
                # 58mm's narrower canvas (same font size everywhere) — pad
                # each column to whichever is wider, its header label or the
                # widest amount actually on this receipt.
                qty_w = _measure(header_font, "Кол-во") + 14
                total_w = max(
                    (_measure(font, f"{item.total:,.0f}") for item in data.items),
                    default=0,
                )
                total_w = max(total_w, _measure(header_font, "Сумма")) + 14
                canvas.item_row("Блюдо", "Кол-во", "Сумма", header_font, qty_w, total_w, gap(6))
                canvas.divider(gap_before=0, gap_after=gap(8))
                for item in data.items:
                    canvas.item_row(item.name, format_quantity(item.qty), f"{item.total:,.0f}", font, qty_w, total_w, gap(6))
                    for mod in item.modifiers:
                        canvas.line_of_text(f"  + {mod}", font, "left", gap(4))
                    # Комментарий к блюду печатаем всегда — пожелание гостя
                    # должно быть в чеке, а не только в шаблоне с «Комментарием».
                    if getattr(item, "note", None):
                        canvas.line_of_text(f"  * {item.note}", font, "left", gap(4))
                # Отменённые блюда — с причиной отмены (возврат денег гостю).
                for item in (getattr(data, "cancelled", None) or []):
                    reason = f" — {item.cancel_reason}" if item.cancel_reason else ""
                    canvas.line_of_text(f"  x {item.name}{reason}", font, "left", gap(4))
            elif block == "paymentMethod" and data.payment_method:
                boundary("financial")
                font, align = _font_for(template, helper, "paymentMethod")
                canvas.text_row(f"{payment_label}:", f"{data.total:,.0f}", font, align, gap(8))
                if data.cash_received is not None:
                    canvas.text_row("Получено:", f"{data.cash_received:,.0f}", font, align, gap(8))
                    canvas.text_row("Сдача:", f"{data.change_given or 0:,.0f}", font, align, gap(8))
            elif block == "thankYouText":
                boundary("footer")
                font, align = _font_for(template, helper, "thankYouText")
                text = template.get("thankYouText") or "XARIDINGIZ\nUCHUN RAXMAT!"
                for para in str(text).split("\n"):
                    canvas.line_of_text(para, font, align, gap(4))
            elif block == "bottomOrderNumber":
                boundary("header" if number_at_top else "footer")
                font, align = _font_for(template, helper, "bottomOrderNumber")
                canvas.line_of_text("НОМЕР ЗАКАЗА", _load_font("regular", 22), align, gap(4))
                canvas.line_of_text(str(data.order_number), font, align, gap(10))
            elif block == "address":
                address = template.get("address")
                if address:
                    boundary("footer")
                    font, align = _font_for(template, helper, "address")
                    canvas.line_of_text(str(address), font, align, gap(8))
            elif block == "phone":
                phone = template.get("phone")
                if phone:
                    boundary("footer")
                    font, align = _font_for(template, helper, "phone")
                    canvas.line_of_text(str(phone), font, align, gap(8))

        if not summary_done:
            render_summary()

        img = canvas.render()
        raster = _to_gs_v0(img)

        ESC = b"\x1b"
        GS = b"\x1d"
        init = ESC + b"\x40"
        feed_cut = b"\n" + GS + b"\x56\x41\x03"
        return init + raster + feed_cut
    except RasterRenderError:
        raise
    except Exception as exc:  # noqa: BLE001 — any layout failure must become the one safe-to-catch type
        raise RasterRenderError(f"raster customer receipt render failed: {exc}") from exc


def render_kitchen_ticket_raster(data: KitchenTicketData, template: dict | None, paper_width_mm: int) -> bytes:
    """Mirrors EscPosFormatter.format_kitchen_ticket()'s own algorithm (same
    KITCHEN_BLOCKS order, same cancelled/showOrderSum/comment gating, same
    course grouping) but draws to the same bitmap pipeline
    render_customer_receipt_raster() uses, instead of printer-native
    monospace text — the kitchen ticket's typography-parity counterpart.
    Business structure (no price/total/payment unless showOrderSum is on)
    is unchanged; only the rendering technology changes.

    Raises RasterRenderError for any failure during layout/rendering — same
    contract as render_customer_receipt_raster, so PrinterService's existing
    text-mode fallback covers kitchen too."""
    try:
        template = template or {}
        data = replace(data, items=grouped_items(data.items))
        helper = EscPosFormatter(paper_width_mm)
        width_px = _WIDTH_BY_MM.get(paper_width_mm, _DEFAULT_WIDTH)
        spacing_mult = {"small": 0.7, "medium": 1.0, "large": 1.3}.get(
            str(template.get("lineSpacing") or "medium").lower(), 1.0
        )

        def en(key: str, default: bool = True) -> bool:
            return EscPosFormatter._enabled(template, key, default)

        def gap(base: int) -> int:
            return max(2, int(base * spacing_mult))

        cancelled = data.status == "cancelled"
        is_item_cancel = getattr(data, "kind", "new") == "item_cancel"
        show_cancel = cancelled and en("cancelOrderNumber", True)
        show_normal_number = (not show_cancel) and en("orderNumber", True)
        item_comment_on = en("comment", en("itemComments", True))
        order_comment_on = en("comment", en("orderNote", True))
        show_money = en("showOrderSum", False)
        order_type_label = format_kitchen_order_type(data.order_type)

        canvas = _RasterCanvas(width_px, separator_style(template))
        any_info = False

        def render_number_block() -> None:
            nonlocal any_info
            font, align = _kitchen_font_for(template, helper, "cancelOrderNumber" if show_cancel else "orderNumber")
            canvas.line_of_text(f"#{data.order_number}", font, align, gap(10))
            if show_cancel:
                canvas.line_of_text("ОТМЕНА", _load_font("bold", font.size), "center", gap(10))
            any_info = True

        def render_row(block: str, label: str, value: str | None) -> None:
            nonlocal any_info
            if not value:
                return
            font, align = _kitchen_font_for(template, helper, block)
            canvas.text_row(label, value, font, align, gap(6))
            any_info = True

        for block in EscPosFormatter._ordered_kitchen(template.get("blocks")):
            if block in ("orderNumber", "cancelOrderNumber"):
                if block == "cancelOrderNumber" and show_cancel:
                    render_number_block()
                elif block == "orderNumber" and show_normal_number:
                    render_number_block()
            elif block == "orderType" and (is_item_cancel or en("orderType", True)):
                header_label = KITCHEN_ITEM_CANCEL_LABEL if is_item_cancel else order_type_label
                if header_label:
                    font, _ = _kitchen_font_for(template, helper, "orderType")
                    if is_item_cancel:
                        font = _load_font("bold", font.size)
                    _, align = _kitchen_font_for(template, helper, "orderNumber")
                    canvas.line_of_text(header_label, font, align, gap(6))
                    any_info = True
            elif block == "table" and en("table", True):
                render_row("table", "Стол:", data.table_number)
            elif block == "waiter" and en("waiter", True):
                render_row("waiter", f"{data.staff_label}:", data.waiter_name)
            elif block == "date" and en("date", en("createdAt", True)):
                render_row("date", "Время:", data.printed_at.strftime("%d.%m.%y %H:%M"))
            # showOrderSum / comment are gates with no own printed position.

        if any_info:
            canvas.divider(gap_before=0, gap_after=gap(10))

        # Dish content always prints; its size and weight are configurable.
        item_font, _ = _kitchen_font_for(template, helper, "dishItems")
        note_font = _load_font("regular", _SIZE_PT["standard"])
        courses: dict[int, list] = {}
        for item in data.items:
            courses.setdefault(item.course or 1, []).append(item)

        # Header and values share column widths even without the money column.
        # The header stays at the normal body size, as in the preview.
        header_font = _load_font("bold", _SIZE_PT["standard"])
        qty_w = max(
            _measure(header_font, "Кол-во"),
            max((_measure(item_font, str(item.qty)) for item in data.items), default=0),
        ) + 14
        total_w = 0
        if show_money:
            total_w = max(
                (_measure(item_font, f"{item.total:,.0f}") for item in data.items if item.total is not None),
                default=0,
            )
            total_w = max(total_w, _measure(header_font, "Сумма")) + 14
        # Large text + amounts on 58mm must not squeeze a dish name into
        # a two-letter-wide strip. Keep its full width and put the numeric
        # cells on the next line; never shrink the user's selected font.
        name_w = width_px - 2 * _MARGIN - qty_w - total_w - 16
        stacked_names = name_w < max(_measure(header_font, "Блюдо"), item_font.size * 4)
        if stacked_names:
            canvas.line_of_text("Блюдо", header_font, "left", gap(2))
        canvas.item_row("" if stacked_names else "Блюдо", "Кол-во", "Сумма" if show_money else "", header_font, qty_w, total_w, gap(6))
        canvas.divider(gap_before=0, gap_after=gap(8))

        for course_num in sorted(courses):
            if len(courses) > 1:
                canvas.line_of_text(f"--- Подача {course_num} ---", _load_font("bold", item_font.size), "left", gap(6))
            for item in courses[course_num]:
                total = f"{item.total:,.0f}" if show_money and item.total is not None else ""
                if stacked_names:
                    canvas.line_of_text(item.name, item_font, "left", gap(2))
                canvas.item_row("" if stacked_names else item.name, str(item.qty), total, item_font, qty_w, total_w, gap(4))
                for mod in item.modifiers:
                    canvas.line_of_text(f"  + {mod}", note_font, "left", gap(2))
                if item_comment_on and item.note:
                    canvas.line_of_text(f"  ! {item.note}", note_font, "left", gap(2))

        if order_comment_on and data.note:
            canvas.divider(gap_before=0, gap_after=gap(8))
            comment_font, align = _kitchen_font_for(template, helper, "comment")
            canvas.line_of_text("Комментарий:", comment_font, align, gap(4))
            canvas.line_of_text(f"- {data.note}", comment_font, align, gap(4))

        canvas.divider(gap_before=0, gap_after=0)

        img = canvas.render().convert("1")
        # Trim the final printable bitmap (not its faint antialiasing pixels),
        # removing all blank rows above the first ink and leaving only a small
        # bottom safety margin. Customer/side margins and all ink stay intact.
        ink_bounds = ImageOps.invert(img.convert("L")).getbbox()
        if ink_bounds:
            img = img.crop((0, ink_bounds[1], img.width, min(img.height, ink_bounds[3] + 4)))
        raster = _to_gs_v0(img)

        ESC = b"\x1b"
        init = ESC + b"\x40"
        # Keep a calibrated small footer instead of restoring three blank lines.
        feed_cut = helper.KITCHEN_CUT
        return init + raster + feed_cut
    except RasterRenderError:
        raise
    except Exception as exc:  # noqa: BLE001 — any layout failure must become the one safe-to-catch type
        raise RasterRenderError(f"raster kitchen ticket render failed: {exc}") from exc


def _to_gs_v0(img: Image.Image) -> bytes:
    bw = img.convert("1")
    width, height = bw.size
    width_bytes = (width + 7) // 8
    pixels = bw.load()
    data = bytearray(width_bytes * height)
    for y in range(height):
        row_off = y * width_bytes
        for x in range(width):
            if pixels[x, y] == 0:
                data[row_off + x // 8] |= 0x80 >> (x % 8)
    header = b"\x1d" + b"v0\x00" + bytes([
        width_bytes & 0xFF, (width_bytes >> 8) & 0xFF,
        height & 0xFF, (height >> 8) & 0xFF,
    ])
    return header + bytes(data)
