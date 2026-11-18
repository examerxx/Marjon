from unittest.mock import patch

import pytest

from app.modules.printers.formatter import EscPosFormatter
from app.modules.printers.receipt_raster import _font_for, _RasterCanvas, render_customer_receipt_raster
from tests.test_receipt_block_styles import _receipt


@pytest.mark.parametrize("size,pixels", [("standard", 26), ("large", 36), ("xlarge", 48)])
def test_number_size_is_separate_from_other_blocks(size, pixels):
    template = {"blockStyles": {"bottomOrderNumber": {"size": size, "weight": "standard"}}}
    with patch("app.modules.printers.receipt_raster._load_font") as load:
        _font_for(template, EscPosFormatter(), "bottomOrderNumber")
    load.assert_called_once_with("regular", pixels)


@pytest.mark.parametrize("placement", ["top", "bottom"])
@pytest.mark.parametrize("enabled", [True, False])
def test_text_number_placement_and_no_duplicate(placement, enabled):
    fmt = EscPosFormatter()
    template = {"restaurantName": "Cafe", "enabled": {"bottomOrderNumber": enabled}, "blockStyles": {"bottomOrderNumber": {"placement": placement}}}
    text = fmt.format_receipt(_receipt(company_name="Cafe", order_number="98765"), template=template).decode("cp866")
    top = placement == "top" and enabled
    assert ("Номер заказа:" in text) == (not top)
    assert ("НОМЕР ЗАКАЗА" in text) == enabled
    assert "Тип заказа:" in text
    if top:
        assert text.index("Cafe") < text.index("98765") < text.index("Тип заказа:")
        assert text.count("98765") == 1


@pytest.mark.parametrize("width", [58, 80])
@pytest.mark.parametrize("placement", ["top", "bottom"])
def test_raster_number_placement(width, placement):
    calls = []
    line = _RasterCanvas.line_of_text
    row = _RasterCanvas.text_row
    def capture_line(self, text, *args, **kwargs):
        calls.append(text)
        return line(self, text, *args, **kwargs)
    def capture_row(self, label, value, *args, **kwargs):
        calls.append(label)
        return row(self, label, value, *args, **kwargs)
    template = {"restaurantName": "Cafe", "blockStyles": {"bottomOrderNumber": {"placement": placement, "size": "xlarge"}}}
    with patch.object(_RasterCanvas, "line_of_text", capture_line), patch.object(_RasterCanvas, "text_row", capture_row):
        raw = render_customer_receipt_raster(_receipt(company_name="Cafe", order_number="98765"), template, width)
    assert raw
    assert calls.count("98765") == 1
    assert ("Номер заказа:" in calls) == (placement == "bottom")
    if placement == "top":
        assert calls.index("Cafe") < calls.index("98765") < calls.index("Тип заказа:")
        assert calls.index("Cafe") < calls.index("НОМЕР ЗАКАЗА") < calls.index("98765")
