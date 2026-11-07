from __future__ import annotations

import pytest
from botocore.exceptions import EndpointConnectionError

from app.shared import storage as storage_module


async def _upload(monkeypatch, **kwargs):
    calls: dict = {}

    class FakeClient:
        def put_object(self, **kw):
            calls.update(kw)

    monkeypatch.setattr("boto3.client", lambda *args, **kw: FakeClient())
    url = await storage_module.StorageService().upload(b"bytes", "categories/x.png", "image/png", **kwargs)
    return url, calls


async def test_storage_upload_public_sets_public_read(monkeypatch):
    """V6.4/V6.5: menu/catalog media (products, categories, logos) renders
    without credentials, so public=True must mark the object public-read."""
    url, calls = await _upload(monkeypatch, public=True)
    assert calls["ACL"] == "public-read"
    assert calls["Key"] == "categories/x.png"
    assert calls["ContentType"] == "image/png"
    assert url.startswith("http")
    assert url.endswith("/categories/x.png")


async def test_storage_upload_private_by_default(monkeypatch):
    """V6.5 media audit: user/staff media must never inherit a blanket-public
    ACL — private is the default, no ACL kwarg is sent at all."""
    url, calls = await _upload(monkeypatch)
    assert "ACL" not in calls
    assert url.endswith("/categories/x.png")


def _down_client(monkeypatch):
    class DownClient:
        def put_object(self, **kw):
            raise EndpointConnectionError(endpoint_url="http://localhost:9000")

    monkeypatch.setattr("boto3.client", lambda *args, **kw: DownClient())


async def test_storage_upload_falls_back_to_local_media_in_debug(monkeypatch, tmp_path):
    """DEV-MEDIA: без запущенного MinIO фото не теряется — файл пишется в
    локальный media-каталог, а URL указывает на backend /media."""
    _down_client(monkeypatch)
    monkeypatch.setattr(storage_module.settings, "debug", True)
    monkeypatch.setattr(
        storage_module.StorageService, "local_root", property(lambda self: tmp_path)
    )
    url = await storage_module.StorageService().upload(b"bytes", "products/x.png", "image/png", public=True)
    assert url == "/media/marjon-media/products/x.png"
    assert (tmp_path / "marjon-media" / "products" / "x.png").read_bytes() == b"bytes"


async def test_storage_upload_still_fails_in_production(monkeypatch):
    """PROD: недоступное хранилище остаётся ошибкой, локальная подмена запрещена."""
    _down_client(monkeypatch)
    monkeypatch.setattr(storage_module.settings, "debug", False)
    with pytest.raises(EndpointConnectionError):
        await storage_module.StorageService().upload(b"bytes", "products/x.png", "image/png")
