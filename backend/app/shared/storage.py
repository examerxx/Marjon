"""S3-compatible object storage (MinIO in dev, any S3 provider in prod).

Usage:
    url = await storage.upload(file_bytes, "products/company-id/prod-id.jpg", "image/jpeg")
    await storage.delete("products/company-id/prod-id.jpg")

Local dev without object storage: when the configured S3 endpoint cannot be
reached and DEBUG is on, files are written to ``backend/media`` and served by
the backend at ``/media/...`` instead of failing the upload. Production
(DEBUG=false) keeps the strict S3 behaviour and surfaces the storage error.
"""
from __future__ import annotations

import asyncio
import logging
import time
from functools import partial
from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError, ConnectTimeoutError, EndpointConnectionError

from app.config import settings

logger = logging.getLogger(__name__)

# Connection-level failures only: an unreachable endpoint means "no local
# object storage installed", while ClientError (bad creds, missing bucket,
# write quorum) must stay visible even in dev.
_UNREACHABLE = (EndpointConnectionError, ConnectTimeoutError, ConnectionError)


class StorageService:
    def __init__(self) -> None:
        self._client = None
        self._local_fallback_logged = False
        # After a connection failure remember the endpoint is down briefly, so
        # every photo in a batch does not pay the connect timeout again.
        self._unreachable_until = 0.0

    def _skip_remote(self) -> bool:
        return settings.debug and time.monotonic() < self._unreachable_until

    def _mark_unreachable(self) -> None:
        self._unreachable_until = time.monotonic() + 30

    def _client_instance(self):
        if self._client is None:
            config_kwargs = {"signature_version": "s3v4"}
            if settings.debug:
                # Without MinIO the default retry budget makes a photo upload
                # hang for ~27s before failing. One short attempt is enough to
                # detect an unreachable dev endpoint.
                config_kwargs.update(connect_timeout=1, read_timeout=15, retries={"total_max_attempts": 1})
            self._client = boto3.client(
                "s3",
                endpoint_url=settings.minio_endpoint,
                aws_access_key_id=settings.minio_access_key,
                aws_secret_access_key=settings.minio_secret_key,
                config=Config(**config_kwargs),
                region_name="us-east-1",
            )
        return self._client

    @property
    def local_root(self) -> Path:
        return Path(__file__).resolve().parents[2] / "media"

    def ensure_local_root(self) -> Path:
        root = self.local_root
        root.mkdir(parents=True, exist_ok=True)
        return root

    def _local_path(self, key: str) -> Path:
        bucket_root = (self.local_root / settings.minio_bucket).resolve()
        path = (bucket_root / key).resolve()
        if not path.is_relative_to(bucket_root):
            raise ValueError("Недопустимый ключ хранилища")
        return path

    def _save_local(self, data: bytes, key: str) -> str:
        path = self._local_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        if not self._local_fallback_logged:
            self._local_fallback_logged = True
            logger.warning(
                "Object storage %s is unreachable — saving media to %s (DEBUG mode)",
                settings.minio_endpoint,
                self.ensure_local_root(),
            )
        return f"/media/{settings.minio_bucket}/{key}"

    async def upload(self, data: bytes, key: str, content_type: str, public: bool = False) -> str:
        """Upload bytes under *key* and return the canonical URL.

        Visibility is explicit per call, never ambient: pass public=True only
        for menu/catalog-style media (products, categories, company logos)
        that browsers render without credentials. User/staff media (avatars)
        stays private (public=False, the default) so future uploads can never
        leak through a blanket-public bucket. V6.4 added unconditional
        public-read; V6.5 scopes it after the media visibility audit.
        """
        if self._skip_remote():
            return await asyncio.to_thread(self._save_local, data, key)
        client = self._client_instance()
        loop = asyncio.get_event_loop()
        put_kwargs = {}
        if public:
            put_kwargs["ACL"] = "public-read"
        try:
            await loop.run_in_executor(
                None,
                partial(
                    client.put_object,
                    Bucket=settings.minio_bucket,
                    Key=key,
                    Body=data,
                    ContentType=content_type,
                    **put_kwargs,
                ),
            )
        except _UNREACHABLE:
            if not settings.debug:
                raise
            self._mark_unreachable()
            return await asyncio.to_thread(self._save_local, data, key)
        return self.public_url(key)

    async def download(self, key: str) -> bytes | None:
        """Download object bytes by key. Returns None if missing (e.g. no
        logo uploaded yet) instead of raising, so callers can degrade gracefully."""
        if self._skip_remote():
            path = self._local_path(key)
            return path.read_bytes() if path.is_file() else None
        client = self._client_instance()
        loop = asyncio.get_event_loop()
        try:
            obj = await loop.run_in_executor(
                None,
                partial(client.get_object, Bucket=settings.minio_bucket, Key=key),
            )
            return obj["Body"].read()
        except ClientError as e:
            if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
                return None
            raise
        except _UNREACHABLE:
            if not settings.debug:
                raise
            self._mark_unreachable()
            path = self._local_path(key)
            return path.read_bytes() if path.is_file() else None

    async def delete(self, key: str) -> None:
        """Delete object by key. Ignores 404."""
        if self._skip_remote():
            self._delete_local(key)
            return
        client = self._client_instance()
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(
                None,
                partial(
                    client.delete_object,
                    Bucket=settings.minio_bucket,
                    Key=key,
                ),
            )
        except ClientError as e:
            if e.response["Error"]["Code"] != "NoSuchKey":
                logger.warning("storage.delete %s: %s", key, e)
        except _UNREACHABLE:
            if not settings.debug:
                raise
            self._mark_unreachable()
            self._delete_local(key)

    def _delete_local(self, key: str) -> None:
        try:
            self._local_path(key).unlink()
        except FileNotFoundError:
            pass

    def public_url(self, key: str) -> str:
        return f"{settings.minio_public_url}/{settings.minio_bucket}/{key}"


storage = StorageService()
