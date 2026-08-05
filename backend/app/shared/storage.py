"""S3-compatible object storage (MinIO in dev, any S3 provider in prod).

Usage:
    url = await storage.upload(file_bytes, "products/company-id/prod-id.jpg", "image/jpeg")
    await storage.delete("products/company-id/prod-id.jpg")
"""
from __future__ import annotations

import asyncio
import logging
from functools import partial

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.config import settings

logger = logging.getLogger(__name__)


class StorageService:
    def __init__(self) -> None:
        self._client = None

    def _client_instance(self):
        if self._client is None:
            self._client = boto3.client(
                "s3",
                endpoint_url=settings.minio_endpoint,
                aws_access_key_id=settings.minio_access_key,
                aws_secret_access_key=settings.minio_secret_key,
                config=Config(signature_version="s3v4"),
                region_name="us-east-1",
            )
        return self._client

    async def upload(self, data: bytes, key: str, content_type: str) -> str:
        """Upload bytes under *key* and return the public URL."""
        client = self._client_instance()
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            partial(
                client.put_object,
                Bucket=settings.minio_bucket,
                Key=key,
                Body=data,
                ContentType=content_type,
            ),
        )
        return f"{settings.minio_public_url}/{settings.minio_bucket}/{key}"

    async def download(self, key: str) -> bytes | None:
        """Download object bytes by key. Returns None if missing (e.g. no
        logo uploaded yet) instead of raising, so callers can degrade gracefully."""
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

    async def delete(self, key: str) -> None:
        """Delete object by key. Ignores 404."""
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

    def public_url(self, key: str) -> str:
        return f"{settings.minio_public_url}/{settings.minio_bucket}/{key}"


storage = StorageService()
