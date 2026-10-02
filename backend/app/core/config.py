from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Application settings, read from environment variables (and backend/.env locally)."""

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Tawkeed Leave Management API"
    environment: Literal["development", "test", "production"] = "development"

    database_url: str
    test_database_url: str | None = None

    jwt_secret_key: SecretStr = Field(min_length=32)
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = Field(default=30, ge=1, le=24 * 60)

    # Stored as a comma-separated string so it works the same in .env files and hosting dashboards.
    cors_origins: str = "http://localhost:5173"

    app_timezone: str = "Asia/Dubai"

    max_failed_logins: int = Field(default=5, ge=1)
    lockout_minutes: int = Field(default=15, ge=1)

    # Lower only in tests to keep them fast; 12 is the production default.
    bcrypt_rounds: int = Field(default=12, ge=4, le=16)

    # Password for the demo accounts created by `python -m app.seed`.
    seed_demo_password: SecretStr | None = None

    @field_validator("database_url", "test_database_url")
    @classmethod
    def _use_psycopg3_driver(cls, value: str | None) -> str | None:
        # Hosting providers usually hand out postgres:// or postgresql:// URLs.
        if value is None:
            return value
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix):]
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
