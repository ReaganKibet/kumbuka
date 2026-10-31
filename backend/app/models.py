from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


ROLES = ("owner", "admin", "supervisor", "counsellor", "lay_counsellor", "me_officer")
ADMIN_ROLES = ("owner", "admin")
CLINICAL_ROLES = ("owner", "admin", "supervisor", "counsellor", "lay_counsellor")


class Organization(Base):
    """An NGO, school, university, counselling centre or private practice. All data belongs to one."""

    __tablename__ = "organizations"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(40), default="ngo")  # ngo | school | university | counselling_centre | private_practice | faith_based | government | other
    country: Mapped[str] = mapped_column(String(2), default="KE")  # ISO 3166-1 alpha-2
    review_all_notes: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    crisis_contacts: Mapped[list | None] = mapped_column(JSON)  # [{name, number, note}] shown to clients on check-ins
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Programme(Base):
    """A funded programme or service line, e.g. 'Schools wellbeing, Nairobi' or 'GBV psychosocial support, Kisumu'."""

    __tablename__ = "programmes"

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    location: Mapped[str | None] = mapped_column(String(200))  # site, county, region or school
    funder: Mapped[str | None] = mapped_column(String(200))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Therapist(Base):
    """A staff member of an organization (kept as 'therapists' for continuity with existing data)."""

    __tablename__ = "therapists"

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), index=True)
    role: Mapped[str] = mapped_column(String(30), default="owner", server_default="owner")
    supervisor_id: Mapped[int | None] = mapped_column(ForeignKey("therapists.id"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
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
    organization_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), index=True)
    programme_id: Mapped[int | None] = mapped_column(ForeignKey("programmes.id"), index=True)
    therapist_id: Mapped[int] = mapped_column(ForeignKey("therapists.id"), index=True)  # assigned counsellor

    # Used only in de-identified reports (counts by gender, age band, location)
    gender: Mapped[str | None] = mapped_column(String(20))  # female | male | other | undisclosed
    location: Mapped[str | None] = mapped_column(String(120))  # county / district / school
    referral_source: Mapped[str | None] = mapped_column(String(60))

    # Minors and safeguarding
    guardian_name: Mapped[str | None] = mapped_column(String(160))
    guardian_phone: Mapped[str | None] = mapped_column(String(40))
    guardian_consent: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    restricted: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")  # only counsellor + their supervisor

    # Lay counsellor asks for clinical support
    escalated_at: Mapped[datetime | None] = mapped_column(DateTime)
    escalation_note: Mapped[str | None] = mapped_column(Text)
    escalated_by_id: Mapped[int | None] = mapped_column(ForeignKey("therapists.id"))

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

    note_status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | submitted | signed
    signed_at: Mapped[datetime | None] = mapped_column(DateTime)

    # Supervision: notes by lay counsellors (or all notes, if the organization says so) need co-signing
    review_status: Mapped[str] = mapped_column(String(20), default="none", server_default="none")  # none | pending | approved | returned
    review_comment: Mapped[str | None] = mapped_column(Text)
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("therapists.id"))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime)

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


class Invite(Base):
    __tablename__ = "invites"

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    email: Mapped[str] = mapped_column(String(255))
    name: Mapped[str | None] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(30))
    supervisor_id: Mapped[int | None] = mapped_column(ForeignKey("therapists.id"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("therapists.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Referral(Base):
    __tablename__ = "referrals"

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), index=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("therapists.id"))
    service: Mapped[str] = mapped_column(String(40))  # medical | psychiatric | legal | protection | gbv | education | economic | social | other
    to_organisation: Mapped[str | None] = mapped_column(String(200))
    to_contact: Mapped[str | None] = mapped_column(String(200))
    reason: Mapped[str | None] = mapped_column(Text)
    urgency: Mapped[str] = mapped_column(String(20), default="routine")  # routine | urgent | emergency
    status: Mapped[str] = mapped_column(String(20), default="made")  # made | accepted | attended | not_attended | declined | closed
    outcome: Mapped[str | None] = mapped_column(Text)
    referred_on: Mapped[date] = mapped_column(Date)
    follow_up_on: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class GroupSession(Base):
    """A group session (school class, support group, psychoeducation) with an attendance register."""

    __tablename__ = "group_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    programme_id: Mapped[int | None] = mapped_column(ForeignKey("programmes.id"), index=True)
    facilitator_id: Mapped[int] = mapped_column(ForeignKey("therapists.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    topic: Mapped[str | None] = mapped_column(String(200))
    location: Mapped[str | None] = mapped_column(String(200))
    held_at: Mapped[datetime] = mapped_column(DateTime, index=True)  # local wall-clock time
    duration_min: Mapped[int] = mapped_column(Integer, default=60)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="held")  # scheduled | held | cancelled
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    attendance: Mapped[list["GroupAttendance"]] = relationship(back_populates="group", cascade="all, delete-orphan")


class GroupAttendance(Base):
    __tablename__ = "group_attendance"

    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("group_sessions.id"), index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), index=True)
    present: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str | None] = mapped_column(Text)

    group: Mapped[GroupSession] = relationship(back_populates="attendance")
    client: Mapped["Client"] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int | None] = mapped_column(ForeignKey("organizations.id"), index=True)
    therapist_id: Mapped[int] = mapped_column(ForeignKey("therapists.id"), index=True)
    action: Mapped[str] = mapped_column(String(40))
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[int | None] = mapped_column(Integer)
    detail: Mapped[str | None] = mapped_column(String(255))
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
