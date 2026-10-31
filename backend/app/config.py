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

    # Google Gemini (aistudio.google.com/apikey). Free keys work, but Google's terms say free-tier
    # content may be read by human reviewers and used to improve Google's products, so on a free key
    # AI only runs on the fictional demo organisation and on anonymised report figures. Turn on
    # billing for the key, then set GEMINI_BILLING_ENABLED=true to use it with real clients.
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    gemini_billing_enabled: bool = _bool("GEMINI_BILLING_ENABLED", False)
    gemini_base_url: str = os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com").rstrip("/")

    @property
    def ai_provider(self) -> str | None:
        choice = os.getenv("AI_PROVIDER", "").strip().lower()
        if choice == "anthropic" and self.anthropic_api_key:
            return "anthropic"
        if choice == "gemini" and self.gemini_api_key:
            return "gemini"
        if self.gemini_api_key:
            return "gemini"
        if self.anthropic_api_key:
            return "anthropic"
        return None

    @property
    def ai_enabled(self) -> bool:
        """An AI key is configured (it may still be limited to the demo; see ai_real_data)."""
        return self.ai_provider is not None

    @property
    def ai_real_data(self) -> bool:
        """Whether AI may process real client records. Never on a free Gemini key."""
        if self.ai_provider == "gemini":
            return self.gemini_billing_enabled
        return self.ai_provider == "anthropic"

    def ai_allowed_for(self, org) -> bool:
        """AI on identifiable client records: real-data provider, or the fictional demo organisation."""
        return self.ai_enabled and (self.ai_real_data or bool(org and org.is_demo))

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
