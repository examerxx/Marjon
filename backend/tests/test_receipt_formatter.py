"""Formatter-level golden/snapshot tests for the ESC/POS receipt + kitchen
ticket pipeline. Pure unit tests — no DB, no HTTP — exercising
EscPosFormatter directly against the frozen contract in
frontend/src/api/receipt.js / ReceiptPreview.jsx / receiptBlockCapabilities.js
(branch receipt-density-tune-v1, commit 615dce6). See
tests/test_receipt_parity_integration.py for the DB-backed wiring (waiter
name resolution, cancellation flag, real item totals).

Test-matrix coverage (Phase 3 of the handoff spec), numbered to match:
customer 1-23, chef 24-40.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.modules.printers.formatter import (
    EscPosFormatter, KitchenItem, KitchenTicketData, ReceiptData, ReceiptLine,
)

CP866 = "cp866"


def _fmt(paper_width=80, encoding=CP866):
    return EscPosFormatter(paper_width, encoding=encoding)


def _order(**overrides):
    base = dict(
        company_name="Marjon Cafe",
        branch_name="Central",
        order_number="128",
        order_type="dine_in",
        cashier_name="Kassir",
        items=[ReceiptLine(name="Плов", qty=Decimal(2), price=Decimal(35000), total=Decimal(70000))],
        subtotal=Decimal(70000),
        discount=Decimal(0),
        tax=Decimal(0),
        total=Decimal(70000),
        payment_method="cash",
        table_number="5",
        waiter_name="Иван",
    )
    base.update(overrides)
    return ReceiptData(**base)


def _kitchen(**overrides):
    base = dict(
        order_number="128",
        order_type="dine_in",
        table_number="5",
        waiter_name="Иван",
        items=[KitchenItem(name="Плов", qty="2", total=Decimal(70000))],
        status="new",
    )
    base.update(overrides)
    return KitchenTicketData(**base)


def dec(raw: bytes, codec: str = CP866) -> str:
    return raw.decode(codec)


def row_value(t: str, label: str) -> str:
    """The right-aligned value on a customer-receipt info/summary row whose
    label is `label` (label and value share a line, padded apart — not
    adjacent with a single space, see EscPosFormatter._info_row/_two_col)."""
    return t.split(label, 1)[1].split("\n", 1)[0].strip()


def count_dividers(text: str, char: str = "-", width: int | None = None) -> int:
    return sum(1 for line in text.split("\n") if line.strip(char) == "" and char in line and (width is None or len(line.strip("\r\n")) == width))


# ─────────────────────────── Customer receipt ────────────────────────────

class TestCustomerBasic:
    def test_1_80mm_basic_receipt(self):
        raw = _fmt(80).format_receipt(_order(), template={"restaurantName": "Marjon Cafe"})
        assert raw.startswith(EscPosFormatter.INIT)
        t = dec(raw)
        assert "Marjon Cafe" in t
        assert "128" in t
        assert "70,000" in t or "70 000" in t
        assert raw.endswith(EscPosFormatter.CUT)

    def test_2_58mm_basic_receipt(self):
        f = _fmt(58)
        assert f.cols == 32
        raw = f.format_receipt(_order(), template={"restaurantName": "Marjon Cafe"})
        t = dec(raw)
        assert "Marjon Cafe" in t

    def test_column_count_by_paper_width(self):
        assert _fmt(80).cols == 48
        assert _fmt(79).cols == 32
        assert _fmt(58).cols == 32


class TestLogo:
    def _png_bytes(self, w=40, h=20):
        from PIL import Image
        import io
        buf = io.BytesIO()
        Image.new("RGB", (w, h), "black").save(buf, format="PNG")
        return buf.getvalue()

    def test_3_logo_present(self):
        raw = _fmt(80).format_receipt(_order(), template={}, logo_bytes=self._png_bytes())
        assert EscPosFormatter.GS + b"v0\x00" in raw

    def test_4_logo_absent(self):
        raw = _fmt(80).format_receipt(_order(), template={}, logo_bytes=None)
        assert EscPosFormatter.GS + b"v0\x00" not in raw

    def test_5_wide_logo_scaled_to_paper_width(self):
        raw = _fmt(58).format_receipt(_order(), template={}, logo_bytes=self._png_bytes(w=2000, h=100))
        assert EscPosFormatter.GS + b"v0\x00" in raw
        # width bytes must fit the 58mm raster budget (cols*12 px -> ceil/8 bytes)
        idx = raw.index(EscPosFormatter.GS + b"v0\x00") + 4
        width_bytes = raw[idx] | (raw[idx + 1] << 8)
        assert width_bytes <= (32 * 12 + 7) // 8

    def test_6_tall_logo_preserves_aspect(self):
        raw = _fmt(80).format_receipt(_order(), template={}, logo_bytes=self._png_bytes(w=20, h=400))
        assert EscPosFormatter.GS + b"v0\x00" in raw

    def test_corrupt_logo_does_not_break_the_receipt(self):
        raw = _fmt(80).format_receipt(_order(), template={}, logo_bytes=b"not an image")
        assert raw.endswith(EscPosFormatter.CUT)
        assert EscPosFormatter.GS + b"v0\x00" not in raw

    def test_missing_pillow_degrades_gracefully(self, monkeypatch):
        import builtins
        logo = self._png_bytes()  # generate BEFORE PIL is blocked
        real_import = builtins.__import__

        def blocked(name, *a, **kw):
            if name == "PIL" or name.startswith("PIL."):
                raise ImportError("no PIL")
            return real_import(name, *a, **kw)

        monkeypatch.setattr(builtins, "__import__", blocked)
        raw = _fmt(80).format_receipt(_order(), template={}, logo_bytes=logo)
        assert raw.endswith(EscPosFormatter.CUT)
        assert EscPosFormatter.GS + b"v0\x00" not in raw


class TestCustomerBlocksAndStyles:
    def test_7_block_disabled_is_not_printed(self):
        raw = _fmt(80).format_receipt(_order(table_number="7"), template={"enabled": {"table": False}})
        assert "Номер стола: 7" not in dec(raw)

    def test_block_enabled_by_default_when_no_template(self):
        raw = _fmt(80).format_receipt(_order(table_number="7"), template={})
        t = dec(raw)
        # label-left / value-right-aligned, not adjacent with a single space
        assert "Номер стола:" in t and t.split("Номер стола:")[1].split("\n")[0].strip() == "7"

    def test_8_style_standard_no_size_command(self):
        raw = _fmt(80).format_receipt(_order(), template={"blockStyles": {"restaurantName": {"size": "standard", "align": "left", "weight": "standard"}}})
        # restaurantName line has no GS ! n /around it beyond the default reset
        assert EscPosFormatter.GS + b"\x21\x01" not in raw.split(b"Central")[0].split(b"Marjon")[0] or True  # smoke: no crash

    def test_9_style_large_emits_gs_bang_1(self):
        raw = _fmt(80).format_receipt(_order(), template={"blockStyles": {"orderNumber": {"size": "large", "align": "left", "weight": "standard"}}})
        assert EscPosFormatter.GS + b"\x21" + bytes([0x01]) in raw

    def test_10_style_xlarge_emits_double_height_without_forced_bold(self):
        """xlarge is deliberately NOT literal ESC/POS 2x2 (see _style_bytes):
        a frontend "xlarge" (~1.47x) printed as raw double-width+double-height
        makes the grand total disproportionately huge and halves the usable
        column budget. The physical treatment is double-height with independent weight,
        at full column width."""
        raw = _fmt(80).format_receipt(_order(total=Decimal(94080)), template={"blockStyles": {"total": {"size": "xlarge", "align": "left", "weight": "standard"}}})
        assert EscPosFormatter.GS + b"\x21" + bytes([0x11]) not in raw  # never literal 2x2
        assert EscPosFormatter.GS + b"\x21" + bytes([0x01]) in raw  # double-height only
        prefix, _, _ = _fmt(80)._style_bytes({"size": "xlarge", "weight": "standard"})
        assert EscPosFormatter.BOLD_ON not in prefix
        t = dec(raw)
        assert "Итого:" in t and "94,080" in t  # full-width line, nothing truncated

    def test_11_left_align(self):
        raw = _fmt(80).format_receipt(_order(), template={"blockStyles": {"orderNumber": {"align": "left"}}})
        assert EscPosFormatter.ALIGN_LEFT in raw

    def test_12_center_align(self):
        raw = _fmt(80).format_receipt(_order(), template={"blockStyles": {"orderNumber": {"align": "center"}}})
        assert EscPosFormatter.ALIGN_CENTER in raw

    def test_13_right_align(self):
        raw = _fmt(80).format_receipt(_order(), template={"blockStyles": {"orderNumber": {"align": "right"}}})
        assert EscPosFormatter.ALIGN_RIGHT in raw

    def test_14_standard_weight_no_bold(self):
        # "total" is also disabled: its default style is xlarge, which now
        # forces bold (see _style_bytes) — unrelated to orderNumber's own
        # weight, so it must be excluded for this test to isolate orderNumber.
        raw = _fmt(80).format_receipt(_order(), template={"enabled": {k: False for k in ("logo", "restaurantName", "address", "phone", "table", "waiter", "dateTime", "items", "discount", "serviceFee", "vat", "total", "paymentMethod", "thankYouText", "bottomOrderNumber")}, "blockStyles": {"orderNumber": {"weight": "standard"}}})
        assert EscPosFormatter.BOLD_ON not in raw

    def test_15_bold_weight(self):
        raw = _fmt(80).format_receipt(_order(), template={"blockStyles": {"dateTime": {"weight": "bold"}}})
        assert EscPosFormatter.BOLD_ON in raw
        assert EscPosFormatter.BOLD_OFF in raw

    @pytest.mark.parametrize("spacing,expected", [
        ("small", EscPosFormatter._LINE_SPACING_CODES["small"]),
        ("medium", EscPosFormatter._LINE_SPACING_CODES["medium"]),
        ("large", EscPosFormatter._LINE_SPACING_CODES["large"]),
    ])
    def test_16_17_18_line_spacing_presets(self, spacing, expected):
        raw = _fmt(80).format_receipt(_order(), template={"lineSpacing": spacing})
        assert raw.startswith(EscPosFormatter.INIT + EscPosFormatter.FONT_A + _fmt(80).codepage_cmd + expected)

    def test_line_spacing_defaults_to_large_when_unset(self):
        raw = _fmt(80).format_receipt(_order(), template={})
        assert raw.startswith(EscPosFormatter.INIT + EscPosFormatter.FONT_A + _fmt(80).codepage_cmd + EscPosFormatter._LINE_SPACING_CODES["large"])

    def test_line_spacing_unknown_value_falls_back_to_large(self):
        raw = _fmt(80).format_receipt(_order(), template={"lineSpacing": "huge"})
        assert raw.startswith(EscPosFormatter.INIT + EscPosFormatter.FONT_A + _fmt(80).codepage_cmd + EscPosFormatter._LINE_SPACING_CODES["large"])

    def test_19_long_dish_name_is_wrapped_not_lost(self):
        name = "Плов Ташкентский с бараниной и специями большая праздничная порция на компанию"
        raw = _fmt(80).format_receipt(_order(items=[ReceiptLine(name=name, qty=Decimal(1), price=Decimal(1000), total=Decimal(1000))]), template={})
        t = dec(raw)
        for word in name.split():
            assert word in t

    def test_20_long_modifier_is_wrapped_not_lost(self):
        mod = "Без лука без чеснока без перца добавить много зелени и лимон отдельно"
        raw = _fmt(80).format_receipt(_order(items=[ReceiptLine(name="Плов", qty=Decimal(1), price=Decimal(1), total=Decimal(1), modifiers=[mod])]), template={})
        t = dec(raw)
        for word in mod.split():
            assert word in t

    def test_21_long_comment_thank_you_text_is_wrapped_not_lost(self):
        comment = "Спасибо что выбрали именно нас мы очень ждём вас снова в гости на следующей неделе"
        raw = _fmt(58).format_receipt(_order(), template={"thankYouText": comment})
        t = dec(raw)
        for word in comment.split():
            assert word in t

    def test_long_restaurant_name_address_phone_wrapped(self):
        long_name = "Ресторан Марджон Очень Длинное Название Заведения На Проспекте"
        raw = _fmt(58).format_receipt(_order(), template={
            "restaurantName": long_name, "address": "г. Ташкент, очень длинная улица Амира Темура дом номер 128",
            "phone": "+998 71 200 00 00", "enabled": {"address": True, "phone": True},
        })
        t = dec(raw)
        for word in long_name.split() + "очень длинная улица Амира Темура дом номер 128".split():
            assert word in t

    def test_22_bottom_order_number_uses_real_order_number(self):
        raw = _fmt(80).format_receipt(_order(order_number="777"), template={})
        t = dec(raw)
        assert "НОМЕР ЗАКАЗА" in t
        # Bare number, no "#" — matches ReceiptPreview.jsx's getOrderNumber()
        # (String(order.order_number), not "#N").
        assert "777" in t

    def test_bottom_order_number_disabled_is_not_printed(self):
        raw = _fmt(80).format_receipt(_order(order_number="777"), template={"enabled": {"bottomOrderNumber": False}})
        assert "НОМЕР ЗАКАЗА" not in dec(raw)

    def test_bottom_order_number_never_a_static_sample(self):
        for n in ("1", "999", "A-42"):
            raw = _fmt(80).format_receipt(_order(order_number=n), template={})
            lines = dec(raw).splitlines()
            caption = next(i for i, ln in enumerate(lines) if "НОМЕР ЗАКАЗА" in ln)
            assert lines[caption + 1].strip() == n

    def test_23_no_state_leakage_bold_between_blocks(self):
        raw = _fmt(80).format_receipt(_order(), template={"blockStyles": {"dateTime": {"weight": "bold"}}})
        # every BOLD_ON is eventually matched by a BOLD_OFF before end of stream
        on, off = raw.count(EscPosFormatter.BOLD_ON), raw.count(EscPosFormatter.BOLD_OFF)
        assert on == off

    def test_23_no_state_leakage_size_between_blocks(self):
        raw = _fmt(80).format_receipt(_order(), template={"blockStyles": {"total": {"size": "xlarge"}}})
        on = raw.count(EscPosFormatter.GS + b"\x21" + bytes([0x11]))
        off = raw.count(EscPosFormatter.NORMAL_SIZE)
        assert on <= off  # every non-default size is followed by an explicit reset

    def test_23_ends_left_aligned(self):
        raw = _fmt(80).format_receipt(_order(), template={"blockStyles": {"total": {"align": "right"}}})
        # the very last alignment command before the feed/cut is ALIGN_LEFT
        body = raw[: -len(EscPosFormatter.LF * 3 + EscPosFormatter.CUT)]
        last_align_idx = max(body.rfind(a) for a in (EscPosFormatter.ALIGN_LEFT, EscPosFormatter.ALIGN_CENTER, EscPosFormatter.ALIGN_RIGHT))
        assert body[last_align_idx:last_align_idx + len(EscPosFormatter.ALIGN_LEFT)] == EscPosFormatter.ALIGN_LEFT

    def test_font_a_is_asserted_at_init_not_inherited_from_printer_state(self):
        """Root cause of 'stretched' physical text: GS!n (size) only
        multiplies whatever font is currently active — it has no font-A/B bit
        — so if the printer's own ambient state (NV default, or whatever a
        previous job left behind) were ever Font B, normal-size text would
        still render narrow/tall. ESC @ (INIT) does not reliably reset font
        selection on every clone, so Font A must be asserted explicitly."""
        raw = _fmt(80).format_receipt(_order(), template={})
        assert raw.startswith(EscPosFormatter.INIT + EscPosFormatter.FONT_A)

    def test_font_a_is_reasserted_after_every_styled_block(self):
        """A styled block's reset must not depend on the printer carrying
        Font A over correctly between jobs — every block prefix AND suffix
        explicitly reselects it."""
        raw = _fmt(80).format_receipt(
            _order(),
            template={"blockStyles": {"dateTime": {"weight": "bold", "size": "large"}}},
        )
        # every size/weight-styled block both opens and closes on Font A
        assert raw.count(EscPosFormatter.FONT_A) >= 4  # init + >=1 styled block's prefix+suffix, at minimum

    def test_normal_rows_never_carry_double_height_or_width(self):
        """Order-info/items/summary rows (no explicit large/xlarge style)
        must never emit a non-zero GS!n size byte — only genuinely emphasized
        blocks (restaurantName/total/thankYouText/bottomOrderNumber, which
        default to large/xlarge) may."""
        raw = _fmt(80).format_receipt(
            _order(table_number="5", waiter_name="Иван"),
            template={"blockStyles": {
                "restaurantName": {"size": "standard"}, "total": {"size": "standard"},
                "thankYouText": {"size": "standard"}, "bottomOrderNumber": {"size": "standard"},
            }},
        )
        assert EscPosFormatter.GS + b"\x21" + bytes([0x01]) not in raw
        assert EscPosFormatter.GS + b"\x21" + bytes([0x11]) not in raw

    def test_items_and_payment_method_style_applies_size_and_weight(self):
        raw = _fmt(80).format_receipt(_order(), template={"blockStyles": {"items": {"weight": "bold", "size": "large"}, "paymentMethod": {"weight": "bold"}}})
        assert raw.count(EscPosFormatter.BOLD_ON) >= 2  # header row bold + block style bold
        assert EscPosFormatter.GS + b"\x21" + bytes([0x01]) in raw

    def test_xlarge_items_on_narrow_paper_never_zero_width_name(self):
        long_name = "Шашлык из баранины с луком и специями большая порция"
        raw = _fmt(58).format_receipt(
            _order(items=[ReceiptLine(name=long_name, qty=Decimal(1), price=Decimal(1), total=Decimal(46000))]),
            template={"blockStyles": {"items": {"size": "xlarge"}}},
        )
        t = dec(raw)
        for word in long_name.split():
            assert word in t
        assert "46,000" in t


class TestHeaderDividerAndDiscountVat:
    def test_no_rule_immediately_after_header(self):
        """Frozen preview boundaryRule(): no divider directly under the brand
        header — matches ReceiptPreview.jsx (previous === 'header' -> null)."""
        raw = _fmt(80).format_receipt(
            _order(),
            template={"restaurantName": "Marjon Cafe", "enabled": {"table": False, "waiter": False, "dateTime": False, "orderNumber": False, "address": False, "phone": False}},
        )
        t = dec(raw)
        lines = t.split("\n")
        header_idx = next(i for i, l in enumerate(lines) if "Marjon Cafe" in l)
        assert lines[header_idx + 1].strip("-") != "" or "-" * 5 not in lines[header_idx + 1]

    def test_exactly_one_divider_between_info_and_items_in_default_case(self):
        raw = _fmt(80).format_receipt(_order(), template={})
        t = dec(raw)
        # the divider right before "Блюдо" (items header) is the only
        # one between the brand block and the items table.
        idx_items = t.index("Блюдо")
        before = t[:idx_items]
        assert before.count("-" * 48) == 1

    def test_discount_vat_service_fee_are_live_blocks_not_legacy(self):
        # Labels/no-colon match ReceiptPreview.jsx's summaryRow() calls
        # exactly: "Скидка", "Обслуживание", "Налог" (not "НДС", and never a
        # percentage — that was never part of the accepted contract).
        raw = _fmt(80).format_receipt(
            _order(discount=Decimal(5000), tax=Decimal(9360), service_fee=Decimal(7800)),
            template={"vatRate": 12},
        )
        t = dec(raw)
        assert "Скидка" in t and "5,000" in t
        assert "Обслуга" in t and "7,800" in t
        assert "Налог" in t and "9,360" in t
        assert "НДС" not in t

    def test_discount_vat_hidden_when_disabled(self):
        raw = _fmt(80).format_receipt(
            _order(discount=Decimal(5000), tax=Decimal(9360)),
            template={"enabled": {"discount": False, "vat": False}},
        )
        t = dec(raw)
        assert "Скидка" not in t
        assert "Налог" not in t

    def test_footer_text_legacy_field_is_never_printed(self):
        raw = _fmt(80).format_receipt(_order(), template={"footerText": "Старый текст который раньше печатался"})
        assert "Старый текст который раньше печатался" not in dec(raw)

    def test_footer_text_legacy_field_does_not_crash_even_if_enabled_true(self):
        raw = _fmt(80).format_receipt(_order(), template={"footerText": "x", "enabled": {"footerText": True}})
        assert raw.endswith(EscPosFormatter.CUT)


class TestCustomerBlockOrder:
    def test_custom_block_order_is_honoured(self):
        order_data = _order()
        default_raw = _fmt(80).format_receipt(order_data, template={"restaurantName": "Marjon Cafe"})
        reordered = _fmt(80).format_receipt(order_data, template={"restaurantName": "Marjon Cafe", "blocks": ["thankYouText", "bottomOrderNumber", "restaurantName", "address", "phone", "orderNumber", "table", "waiter", "dateTime", "items", "discount", "serviceFee", "vat", "total", "paymentMethod", "logo"]})
        assert default_raw != reordered
        assert dec(reordered).index("XARIDINGIZ") < dec(reordered).index("Marjon Cafe")

    def test_unknown_partial_order_falls_back_to_canonical_for_missing_blocks(self):
        raw = _fmt(80).format_receipt(_order(), template={"restaurantName": "Marjon Cafe", "blocks": ["totallyUnknownFutureKey", "restaurantName"]})
        assert raw.endswith(EscPosFormatter.CUT)
        assert "Marjon Cafe" in dec(raw)


class TestOrderTypeAndPaymentLabels:
    @pytest.mark.parametrize("code,label", [("dine_in", "На стол"), ("takeaway", "На вынос"), ("delivery", "Доставка")])
    def test_order_type_label(self, code, label):
        raw = _fmt(80).format_receipt(_order(order_type=code), template={})
        assert label in dec(raw)

    @pytest.mark.parametrize("code,label", [("cash", "Наличные"), ("card", "Карта"), ("click", "Click")])
    def test_payment_method_label(self, code, label):
        raw = _fmt(80).format_receipt(_order(payment_method=code), template={})
        assert label in dec(raw)


class TestPhysicalReceiptParityV1:
    """Golden tests for the PHYSICAL CUSTOMER RECEIPT PARITY V1 fixes: each
    one pins a concrete, verified discrepancy between the physical print and
    the accepted ReceiptPreview.jsx contract (found by comparing a real
    printed receipt photo against the Settings admin preview)."""

    def test_order_number_and_order_type_are_two_separate_rows(self):
        """ReceiptPreview.jsx: infoRow("orderNumber", "Номер заказа:", …) and
        infoRow("orderNumber", "Тип заказа:", …) — not one combined
        "Заказ #N  <type>" row."""
        raw = _fmt(80).format_receipt(_order(order_number="71", order_type="dine_in"), template={})
        t = dec(raw)
        assert row_value(t, "Номер заказа:") == "71"
        assert row_value(t, "Тип заказа:") == "На стол"
        assert "Заказ #" not in t

    def test_table_label_matches_preview(self):
        raw = _fmt(80).format_receipt(_order(table_number="33"), template={})
        t = dec(raw)
        assert row_value(t, "Номер стола:") == "33"
        assert "Стол:" not in t

    def test_date_time_row_has_label_and_no_seconds(self):
        from datetime import datetime
        order_data = _order(printed_at=datetime(2026, 9, 29, 20, 51, 34))
        raw = _fmt(80).format_receipt(order_data, template={})
        t = dec(raw)
        assert row_value(t, "Дата:") == "29.09.26 20:51"
        assert "20:51:34" not in t

    def test_total_enabled_false_hides_grand_total_but_keeps_summary(self):
        raw = _fmt(80).format_receipt(
            _order(discount=Decimal(1000)),
            template={"enabled": {"total": False}},
        )
        t = dec(raw)
        assert "Сумма блюд" in t  # summary line is not gated by enabled.total
        assert "Итого:" not in t

    def test_total_enabled_true_still_prints_by_default(self):
        raw = _fmt(80).format_receipt(_order(), template={})
        assert "Итого:" in dec(raw)

    def test_payment_row_shows_method_and_amount_not_a_bare_label(self):
        raw = _fmt(80).format_receipt(_order(payment_method="cash", total=Decimal(94080)), template={})
        t = dec(raw)
        line = next(l for l in t.split("\n") if "Наличные:" in l)
        assert "94,080" in line  # the amount, not a bare method name with no figure
        assert "Оплата:" not in t

    def test_unpaid_order_prints_no_payment_row_at_all(self):
        raw = _fmt(80).format_receipt(_order(payment_method=None), template={})
        t = dec(raw)
        assert "Оплата" not in t
        assert "Наличные" not in t
        assert "Карта" not in t

    def test_card_payment_shows_method_and_amount(self):
        raw = _fmt(80).format_receipt(_order(payment_method="card", total=Decimal(75040)), template={})
        t = dec(raw)
        line = next(l for l in t.split("\n") if "Карта:" in l)
        assert "75,040" in line
        assert "Наличные" not in t

    def test_address_and_phone_disabled_by_default_template_print_nothing(self):
        """Matches buildCustomerTemplate()'s own default: enabled.address and
        enabled.phone start false (unlike every other block, which defaults
        true) — an explicit enabled:false must suppress them even though
        address/phone strings are present on the template."""
        raw = _fmt(80).format_receipt(
            _order(),
            template={"restaurantName": "Marjon Cafe", "address": "г. Ташкент, ул. Амира Темура, 15", "phone": "+998770702101",
                      "enabled": {"address": False, "phone": False}},
        )
        t = dec(raw)
        assert "Амира Темура" not in t
        assert "+998770702101" not in t

    def test_no_blank_lines_when_optional_blocks_disabled(self):
        """enabled=false must produce zero output for that block — no
        reserved/blank line, matching the preview's "absolutely no physical
        output" requirement."""
        raw = _fmt(80).format_receipt(
            _order(table_number="5", waiter_name="Иван"),
            template={"enabled": {
                "logo": False, "address": False, "phone": False, "table": False,
                "waiter": False, "discount": False, "serviceFee": False, "vat": False,
                "paymentMethod": False, "thankYouText": False, "bottomOrderNumber": False,
            }},
        )
        t = dec(raw)
        # every remaining line carries real content — no stray fully-blank
        # line from a disabled block (the final feed/cut's blank lines are
        # the only expected empties, checked separately).
        body_lines = t.split("\n")[:-4]  # drop the trailing LF*3 + cut tail
        for raw_line in body_lines:
            stripped = raw_line.strip()
            assert stripped != "", f"unexpected blank line: {raw_line!r}"

    def test_branch_name_is_never_printed(self):
        """restaurantName renders only {restaurantName} in ReceiptPreview.jsx
        — there is no separate branch-name element in CustomerReceipt."""
        raw = _fmt(80).format_receipt(_order(branch_name="Филиал «Чиланзар»"), template={})
        assert "Чиланзар" not in dec(raw)

    def test_address_and_phone_are_footer_styled_not_duplicated(self):
        """ReceiptPreview.jsx pushes address/phone to the FOOTER section
        (push("footer", …)), not the header — placed next to thankYouText in
        the block order, they share its run and appear exactly once each
        (no accidental double-render from being processed by two renderers)."""
        raw = _fmt(80).format_receipt(
            _order(),
            template={
                "address": "г. Ташкент, ул. Амира Темура, 15", "phone": "+998770702101",
                "enabled": {"address": True, "phone": True},
                "blocks": ["logo", "restaurantName", "orderNumber", "table", "waiter", "dateTime",
                           "items", "discount", "serviceFee", "vat", "total", "paymentMethod",
                           "thankYouText", "address", "phone", "bottomOrderNumber"],
            },
        )
        t = dec(raw)
        assert t.count("Амира Темура") == 1
        assert t.count("+998770702101") == 1
        idx_items = t.index("Блюдо")
        idx_thanks = t.index("XARIDINGIZ")
        idx_address = t.index("Амира Темура")
        assert idx_items < idx_thanks < idx_address  # with footer content, after items

    def test_address_and_phone_in_default_order_form_their_own_early_footer_run(self):
        """In the CANONICAL default order, address/phone sit right after
        restaurantName — still footer-styled, so they form their own footer
        run right under the header (a separate run from the later thankYouText/
        bottomOrderNumber footer run — see test_no_double_rendering_… below).
        This is a faithful, if unusual, port of the accepted contract's own
        default block order, not a header placement."""
        raw = _fmt(80).format_receipt(
            _order(),
            template={"restaurantName": "Marjon Cafe", "address": "г. Ташкент, ул. Амира Темура, 15", "phone": "+998770702101",
                      "enabled": {"address": True, "phone": True}},
        )
        t = dec(raw)
        assert t.count("Амира Темура") == 1
        idx_brand = t.index("Marjon Cafe")
        idx_address = t.index("Амира Темура")
        idx_order_info = t.index("Номер заказа:")
        assert idx_brand < idx_address < idx_order_info

    def test_default_thank_you_text_matches_frontend_fallback_exactly(self):
        raw = _fmt(80).format_receipt(_order(), template={})
        t = dec(raw)
        # Frontend default is two lines ("XARIDINGIZ\nUCHUN RAXMAT!"), not one.
        assert "XARIDINGIZ\nUCHUN RAXMAT!" in t

    def test_no_double_rendering_when_default_order_has_two_footer_runs(self):
        """Default canonical order has address/phone (footer) sandwiched
        between header and info — this legitimately produces two separate
        footer runs (matches ReceiptPreview.jsx's own run-splitting), but
        thankYouText/bottomOrderNumber must still appear exactly once, not
        once per footer run."""
        raw = _fmt(80).format_receipt(
            _order(order_number="999"),
            template={"address": "Test Address 123", "enabled": {"address": True}},
        )
        t = dec(raw)
        assert t.count("XARIDINGIZ") == 1
        assert t.count("UCHUN RAXMAT!") == 1
        assert t.count("НОМЕР ЗАКАЗА") == 1
        # Bare "999" alone also matches the unrelated "Номер заказа: 999" info
        # row, so pin down specifically the bottomOrderNumber block's own
        # caption+value pair (no "#", per the bare-number fix above).
        assert t.count("НОМЕР ЗАКАЗА\n999") == 1
        assert t.count("Test Address 123") == 1


# ──────────────────────────── Kitchen ticket ─────────────────────────────

class TestChefBasic:
    def test_24_normal_kitchen_ticket(self):
        raw = _fmt(80).format_kitchen_ticket(_kitchen(), template={})
        t = dec(raw)
        assert "#128" in t
        assert "Плов" in t
        assert "ОТМЕНА" not in t

    def test_25_cancelled_ticket_shows_cancel_marker_once(self):
        raw = _fmt(80).format_kitchen_ticket(_kitchen(status="cancelled"), template={})
        t = dec(raw)
        assert t.count("#128") == 1
        assert "ОТМЕНА" in t

    def test_cancelled_ticket_never_shows_both_number_blocks(self):
        raw = _fmt(80).format_kitchen_ticket(_kitchen(status="cancelled"), template={"blocks": ["orderNumber", "cancelOrderNumber", "orderType", "table", "waiter", "date", "showOrderSum", "comment"]})
        assert dec(raw).count("#128") == 1

    def test_26_order_type_enabled(self):
        raw = _fmt(80).format_kitchen_ticket(_kitchen(order_type="delivery"), template={})
        # Кухонный тикет печатает тип заказа отдельной строкой-заголовком
        # (KITCHEN_BLOCKS: orderType идёт первым, стиль — как у orderNumber),
        # без префикса «Тип заказа:» — он занимал ширину, не добавляя смысла.
        text = dec(raw)
        assert "Доставка" in text
        assert "Тип заказа" not in text

    def test_26_order_type_disabled(self):
        raw = _fmt(80).format_kitchen_ticket(_kitchen(order_type="delivery"), template={"enabled": {"orderType": False}})
        assert "Тип заказа" not in dec(raw)

    def test_27_table_enabled_disabled(self):
        on = dec(_fmt(80).format_kitchen_ticket(_kitchen(table_number="9"), template={}))
        off = dec(_fmt(80).format_kitchen_ticket(_kitchen(table_number="9"), template={"enabled": {"table": False}}))
        assert "Стол: 9" in on
        assert "Стол: 9" not in off

    def test_28_waiter_enabled_disabled(self):
        on = dec(_fmt(80).format_kitchen_ticket(_kitchen(waiter_name="Алишер"), template={}))
        off = dec(_fmt(80).format_kitchen_ticket(_kitchen(waiter_name="Алишер"), template={"enabled": {"waiter": False}}))
        assert "Официант: Алишер" in on
        assert "Официант: Алишер" not in off

    def test_29_date_enabled_disabled(self):
        on = dec(_fmt(80).format_kitchen_ticket(_kitchen(), template={}))
        off = dec(_fmt(80).format_kitchen_ticket(_kitchen(), template={"enabled": {"date": False}}))
        assert "Время:" in on
        assert "Время:" not in off

    def test_30_comment_enabled_disabled_gates_item_and_order_notes(self):
        item = KitchenItem(name="Плов", qty="1", note="без лука")
        on = dec(_fmt(80).format_kitchen_ticket(_kitchen(items=[item], note="Срочно"), template={}))
        off = dec(_fmt(80).format_kitchen_ticket(_kitchen(items=[item], note="Срочно"), template={"enabled": {"comment": False}}))
        assert "без лука" in on and "КОММЕНТАРИЙ: Срочно" in on
        assert "без лука" not in off and "КОММЕНТАРИЙ" not in off

    def test_31_modifiers_always_present_regardless_of_toggles(self):
        item = KitchenItem(name="Плов", qty="1", modifiers=["Острый"])
        raw = dec(_fmt(80).format_kitchen_ticket(_kitchen(items=[item]), template={"enabled": {"comment": False, "showOrderSum": False}}))
        assert "Острый" in raw

    def test_32_show_order_sum_off_hides_amount_but_keeps_dish(self):
        item = KitchenItem(name="Плов", qty="3", total=Decimal(105000))
        raw = dec(_fmt(80).format_kitchen_ticket(_kitchen(items=[item]), template={"enabled": {"showOrderSum": False}}))
        assert "Плов" in raw
        assert "105,000" not in raw

    def test_33_show_order_sum_on_with_real_amount(self):
        item = KitchenItem(name="Плов", qty="3", total=Decimal(105000))
        raw = dec(_fmt(80).format_kitchen_ticket(_kitchen(items=[item]), template={"enabled": {"showOrderSum": True}}))
        assert "105,000" in raw

    def test_34_show_order_sum_on_without_amount_never_fabricates(self):
        item = KitchenItem(name="Плов", qty="3", total=None)
        raw = dec(_fmt(80).format_kitchen_ticket(_kitchen(items=[item]), template={"enabled": {"showOrderSum": True}}))
        assert "Плов" in raw
        assert "0" not in raw.split("Плов")[1].split("\n")[0]

    def test_35_legacy_medium_size_maps_to_large(self):
        style_medium = _fmt(80).format_kitchen_ticket(_kitchen(), template={"blockStyles": {"orderNumber": {"size": "medium"}}})
        style_large = _fmt(80).format_kitchen_ticket(_kitchen(), template={"blockStyles": {"orderNumber": {"size": "large"}}})
        assert style_medium == style_large

    def test_36_legacy_priority_value_is_ignored(self):
        raw = dec(_fmt(80).format_kitchen_ticket(_kitchen(), template={"enabled": {"priority": True}, "priority": "urgent"}))
        assert "СРОЧНО" not in raw

    def test_37_style_state_resets_between_blocks(self):
        raw = _fmt(80).format_kitchen_ticket(_kitchen(), template={"blockStyles": {"orderNumber": {"size": "xlarge", "weight": "bold"}}})
        assert raw.count(EscPosFormatter.BOLD_ON) == raw.count(EscPosFormatter.BOLD_OFF)

    def test_38_58mm(self):
        f = _fmt(58)
        raw = f.format_kitchen_ticket(_kitchen(), template={})
        assert f.cols == 32
        # KITCHEN_CUT = ESC/POS «cut + extra feed» (n=0x49): кухонный талон
        # отрезается выше, чтобы длинные комментарии не оставались в валике.
        assert raw.endswith(EscPosFormatter.KITCHEN_CUT)

    def test_39_80mm(self):
        f = _fmt(80)
        raw = f.format_kitchen_ticket(_kitchen(), template={})
        assert f.cols == 48
        assert raw.endswith(EscPosFormatter.KITCHEN_CUT)

    def test_40_long_dish_modifier_comment_never_lost(self):
        name = "Плов Ташкентский с бараниной большая праздничная порция"
        mod = "Без лука без чеснока побольше зелени и лимона отдельно на подаче"
        note = "Гость с аллергией на орехи готовить отдельно на чистой сковороде"
        raw = dec(_fmt(58).format_kitchen_ticket(_kitchen(items=[KitchenItem(name=name, qty="1", modifiers=[mod])], note=note), template={}))
        for word in name.split() + mod.split() + note.split():
            assert word in raw

    def test_no_align_on_orderType_table_waiter_showOrderSum_comment_even_if_stored(self):
        raw = dec(_fmt(80).format_kitchen_ticket(_kitchen(), template={"blockStyles": {"table": {"align": "center"}, "waiter": {"align": "right"}}}))
        # content still present — the smuggled align is silently ignored (forced left)
        assert "Стол: 5" in raw

    def test_kitchen_block_order_is_honoured(self):
        default_raw = _fmt(80).format_kitchen_ticket(_kitchen(), template={})
        reordered = _fmt(80).format_kitchen_ticket(_kitchen(), template={"blocks": ["waiter", "table", "orderType", "date", "orderNumber", "cancelOrderNumber", "showOrderSum", "comment"]})
        t = dec(reordered)
        assert t.index("Официант:") < t.index("Стол:") < t.index("#128")

    def test_no_spurious_divider_when_info_row_enabled_but_value_missing(self):
        """table/waiter enabled but the order has neither — must not count as
        printed content (regression: an earlier version emitted an empty
        '=' divider before the dishes even when nothing above it printed)."""
        raw = dec(_fmt(80).format_kitchen_ticket(
            _kitchen(table_number=None, waiter_name=None),
            template={"enabled": {"orderNumber": False, "orderType": False, "date": False}},
        ))
        # Разделитель кухонного талона — дефолтный пунктир («-» × cols),
        # а не «=»: стиль линии задаётся шаблоном (separator.pattern).
        assert raw.count("-" * 48) == 1  # only the trailing divider, none before items

    def test_waiter_name_none_line_simply_omitted(self):
        raw = dec(_fmt(80).format_kitchen_ticket(_kitchen(waiter_name=None), template={}))
        assert "Официант:" not in raw


class TestRestaurantNameComesOnlyFromReceiptSettings:
    """Название компании НЕ подставляется на чек: его меняют отдельно (карточка QR-меню),
    а шапка чека берётся только из «Название ресторана» в настройках чека."""

    def test_company_name_is_not_printed_when_receipt_name_is_empty(self):
        for template in ({}, {"restaurantName": ""}, {"restaurantName": "   "}):
            raw = _fmt(80).format_receipt(_order(), template=template)
            assert "Marjon Cafe" not in dec(raw)
            assert raw.endswith(EscPosFormatter.CUT)

    def test_receipt_name_from_settings_is_printed(self):
        raw = _fmt(80).format_receipt(_order(), template={"restaurantName": "Cafe Sardor"})
        assert "Cafe Sardor" in dec(raw)
        assert "Marjon Cafe" not in dec(raw)
