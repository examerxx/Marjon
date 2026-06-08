from __future__ import annotations
from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "SaaS Restaurant Platform"
    debug: bool = False

    secret_key: str | None = None
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30

    database_url: str
    migration_database_url: str | None = None
    redis_url: str = "redis://localhost:6379/0"

    allowed_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    class Config:
        env_file = ".env"

    @model_validator(mode="after")
    def validate_security(self):
        if not self.secret_key:
            if self.debug:
                self.secret_key = "dev-only-insecure-secret-key"
            else:
                raise ValueError("SECRET_KEY must be set when DEBUG=false")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
