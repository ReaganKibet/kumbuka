from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

_url = settings.database_url
# Supabase / Heroku style URLs sometimes start with postgres:// which SQLAlchemy rejects.
if _url.startswith("postgres://"):
    _url = _url.replace("postgres://", "postgresql+psycopg://", 1)

_connect_args = {"check_same_thread": False} if _url.startswith("sqlite") else {}
engine = create_engine(_url, connect_args=_connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_migrations() -> None:
    """Bring the database schema up to date. Safe to run on every start."""
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    root = Path(__file__).resolve().parents[1]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "migrations"))
    command.upgrade(cfg, "head")
