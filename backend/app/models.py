from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Therapist(Base):
    __tablename__ = "therapists"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))

    # Letterhead for printed notes and letters
    title: Mapped[str | None] = mapped_column(String(120))  # e.g. "Counselling Psychologist"
    practice_name: Mapped[str | None] = mapped_column(String(160))
    phone: Mapped[str | None] = mapped_column(String(40))
    address: Mapped[str | None] = mapped_column(Text)
    license_no: Mapped[str | None] = mapped_column(String(80))

    # Security
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # bump = sign out everywhere
    totp_secret_enc: Mapped[str | None] = mapped_column(Text)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    totp_last_counter: Mapped[int | None] = mapped_column(Integer)
    recovery_codes: Mapped[list | None] = mapped_column(JSON)  # sha256 hashes, removed once used
    failed_logins: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(primary_key=True)
    therapist_id: Mapped[int] = mapped_column(ForeignKey("therapists.id"), index=True)

    full_name: Mapped[str] = mapped_column(String(160))
    preferred_name: Mapped[str | None] = mapped_column(String(80))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    phone: Mapped[str | None] = mapped_column(String(40))
    email: Mapped[str | None] = mapped_column(String(255))
    emergency_contact_name: Mapped[str | None] = mapped_column(String(160))
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(40))

    presenting_concern: Mapped[str | None] = mapped_column(Text)
    background: Mapped[str | None] = mapped_column(Text)

    consent_signed: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_ai: Mapped[bool] = mapped_column(Boolean, default=False)

    risk_level: Mapped[str] = mapped_column(String(20), default="none")  # none | low | medium | high
    risk_notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | paused | closed

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    sessions: Mapped[list["CounselingSession"]] = relationship(back_populates="client", cascade="all, delete-orphan")


class CounselingSession(Base):
    """One appointment and its session note (DAP format)."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    therapist_id: Mapped[int] = mapped_column(ForeignKey("therapists.id"), index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), index=True)

    scheduled_at: Mapped[datetime] = mapped_column(DateTime, index=True)  # local wall-clock time
    duration_min: Mapped[int] = mapped_column(Integer, default=50)
    status: Mapped[str] = mapped_column(String(20), default="scheduled")  # scheduled | attended | cancelled | no_show

    mood_rating: Mapped[int | None] = mapped_column(Integer)  # client self-rating 1-10
    dictation: Mapped[str | None] = mapped_column(Text)  # raw dictation / rough notes
    data: Mapped[str | None] = mapped_column(Text)  # D: what the client reported + what was observed
    assessment: Mapped[str | None] = mapped_column(Text)  # A: counselor's interpretation
    plan: Mapped[str | None] = mapped_column(Text)  # P: next steps
    interventions: Mapped[str | None] = mapped_column(Text)
    homework: Mapped[str | None] = mapped_column(Text)
    risk_check: Mapped[str | None] = mapped_column(Text)
    private_note: Mapped[str | None] = mapped_column(Text)  # counselor's own reflections, never exported

    note_status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | signed
    signed_at: Mapped[datetime | None] = mapped_column(DateTime)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    client: Mapped[Client] = relationship(back_populates="sessions")
    addenda: Mapped[list["Addendum"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="Addendum.created_at"
    )


class Addendum(Base):
    """Corrections or additions to a signed note. Signed notes are never edited in place."""

    __tablename__ = "addenda"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    therapist_id: Mapped[int] = mapped_column(ForeignKey("therapists.id"))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    session: Mapped[CounselingSession] = relationship(back_populates="addenda")


class Assessment(Base):
    __tablename__ = "assessments"

    id: Mapped[int] = mapped_column(primary_key=True)
    therapist_id: Mapped[int] = mapped_column(ForeignKey("therapists.id"), index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # PHQ-9 | GAD-7
    answers: Mapped[list] = mapped_column(JSON)
    total: Mapped[int] = mapped_column(Integer)
    severity: Mapped[str] = mapped_column(String(40))
    flags: Mapped[list] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(20), default="counselor", server_default="counselor")  # counselor | client
    taken_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    therapist_id: Mapped[int] = mapped_column(ForeignKey("therapists.id"), index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), index=True)
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | achieved | dropped
    progress: Mapped[int] = mapped_column(Integer, default=0)  # 0-100
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class CheckinLink(Base):
    """A one-time link the client opens on their phone to fill in questionnaires before a session."""

    __tablename__ = "checkin_links"

    id: Mapped[int] = mapped_column(primary_key=True)
    therapist_id: Mapped[int] = mapped_column(ForeignKey("therapists.id"), index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # the token itself is never stored
    kinds: Mapped[list] = mapped_column(JSON)
    expires_at: Mapped[datetime] = mapped_column(DateTime)  # UTC
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)
    mood: Mapped[int | None] = mapped_column(Integer)
    message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Letter(Base):
    __tablename__ = "letters"

    id: Mapped[int] = mapped_column(primary_key=True)
    therapist_id: Mapped[int] = mapped_column(ForeignKey("therapists.id"), index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), index=True)
    kind: Mapped[str] = mapped_column(String(30))  # attendance | referral | general
    recipient: Mapped[str | None] = mapped_column(Text)
    subject: Mapped[str | None] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    therapist_id: Mapped[int] = mapped_column(ForeignKey("therapists.id"), index=True)
    action: Mapped[str] = mapped_column(String(40))
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    detail: Mapped[str | None] = mapped_column(String(255))
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
