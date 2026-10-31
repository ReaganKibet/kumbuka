import base64
import hashlib
import os
import warnings
from datetime import datetime
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

load_dotenv()


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


class Settings:
    # Render sets RENDER=true on every service; treat that as production.
    production: bool = _bool("RENDER", False) or os.getenv("ENVIRONMENT", "").lower() == "production"

    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./kumbuka.db")
    secret_key: str = os.getenv("SECRET_KEY", "dev-secret-change-me")
    token_hours: int = int(os.getenv("TOKEN_HOURS", "12"))
    idle_lock_minutes: int = int(os.getenv("IDLE_LOCK_MINUTES", "15"))
    app_timezone: str = os.getenv("APP_TIMEZONE", "Africa/Nairobi")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5-5")
    cors_origins: list[str] = [
        o.strip().rstrip("/")
        for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
        if o.strip()
    ]
    # "first": only the very first account can be created (the default, safe for a public URL)
    # "true": anyone can register   "false": nobody can
    registration: str = os.getenv("ALLOW_REGISTRATION", "first").strip().lower()
    docs_enabled: bool = _bool("ENABLE_API_DOCS", not production)
    checkin_default_days: int = int(os.getenv("CHECKIN_DAYS", "3"))
    # Public one-click demo organization (fictional data) for investors and partners
    demo_enabled: bool = _bool("DEMO_ENABLED", False)

    @property
    def ai_enabled(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def fernet_key(self) -> bytes:
        """Key for encrypting small secrets (2FA seeds) at rest, derived from SECRET_KEY."""
        return base64.urlsafe_b64encode(hashlib.sha256(b"kumbuka-fernet:" + self.secret_key.encode()).digest())


settings = Settings()

if settings.production:
    if settings.database_url.startswith("sqlite"):
        raise RuntimeError(
            "DATABASE_URL points to SQLite, whose file is wiped on every deploy. "
            "Set DATABASE_URL to a Postgres connection string (e.g. Supabase) before starting in production."
        )
    if settings.secret_key == "dev-secret-change-me" or len(settings.secret_key) < 32:
        raise RuntimeError("Set SECRET_KEY to a long random value (32+ characters) in production.")
elif settings.secret_key == "dev-secret-change-me":
    warnings.warn("SECRET_KEY is the development default. Set a long random SECRET_KEY before real use.")


def local_now() -> datetime:
    """Current wall-clock time in the practice's timezone, as a naive datetime.

    Appointment times are stored as the counselor's local wall-clock time, so all
    comparisons against "now" use the same convention.
    """
    return datetime.now(ZoneInfo(settings.app_timezone)).replace(tzinfo=None)
