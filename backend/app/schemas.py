from datetime import date, datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, PlainSerializer

# System timestamps (created, signed, audit) are stored as naive UTC; send them with a
# timezone so browsers convert them to local time. Appointment times (scheduled_at,
# taken_at) are already the counselor's local wall-clock time and are sent as-is.
UTC = Annotated[datetime, PlainSerializer(lambda d: d.replace(tzinfo=timezone.utc).isoformat(), return_type=str)]

RiskLevel = Literal["none", "low", "medium", "high"]
ClientStatus = Literal["active", "paused", "closed"]
SessionStatus = Literal["scheduled", "attended", "cancelled", "no_show"]
GoalStatus = Literal["active", "achieved", "dropped"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- auth ----------
PASSWORD = Field(min_length=10, max_length=200)


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = PASSWORD


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)


class MfaIn(BaseModel):
    mfa_token: str
    code: str = Field(min_length=6, max_length=20)  # 6-digit app code or a recovery code


class TherapistOut(ORM):
    id: int
    name: str
    email: str
    title: str | None = None
    practice_name: str | None = None
    phone: str | None = None
    address: str | None = None
    license_no: str | None = None
    totp_enabled: bool = False
    recovery_codes_left: int = 0


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    title: str | None = Field(default=None, max_length=120)
    practice_name: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=40)
    address: str | None = Field(default=None, max_length=500)
    license_no: str | None = Field(default=None, max_length=80)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = PASSWORD


class TotpSetupOut(BaseModel):
    secret: str
    otpauth_uri: str


class TotpCode(BaseModel):
    code: str = Field(min_length=6, max_length=20)


class TotpDisable(BaseModel):
    password: str
    code: str = Field(min_length=6, max_length=20)


class RecoveryCodesOut(BaseModel):
    recovery_codes: list[str]


class TokenOut(BaseModel):
    token: str
    therapist: TherapistOut


class LoginOut(BaseModel):
    token: str | None = None
    therapist: TherapistOut | None = None
    mfa_required: bool = False
    mfa_token: str | None = None


class AuthConfigOut(BaseModel):
    registration_open: bool
    idle_lock_minutes: int
    ai_enabled: bool


# ---------- clients ----------
class ClientBase(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    preferred_name: str | None = None
    date_of_birth: date | None = None
    phone: str | None = None
    email: str | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    presenting_concern: str | None = None
    background: str | None = None
    consent_signed: bool = False
    consent_ai: bool = False
    risk_level: RiskLevel = "none"
    risk_notes: str | None = None
    status: ClientStatus = "active"


class ClientCreate(ClientBase):
    pass


class ClientUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=160)
    preferred_name: str | None = None
    date_of_birth: date | None = None
    phone: str | None = None
    email: str | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    presenting_concern: str | None = None
    background: str | None = None
    consent_signed: bool | None = None
    consent_ai: bool | None = None
    risk_level: RiskLevel | None = None
    risk_notes: str | None = None
    status: ClientStatus | None = None


class ClientOut(ClientBase, ORM):
    id: int
    created_at: UTC
    updated_at: UTC


class ClientListItem(ORM):
    id: int
    full_name: str
    preferred_name: str | None
    risk_level: str
    status: str
    last_session: datetime | None = None
    next_session: datetime | None = None
    session_count: int = 0
    unsigned_notes: int = 0


# ---------- sessions ----------
class SessionCreate(BaseModel):
    scheduled_at: datetime
    duration_min: int = Field(default=50, ge=5, le=480)


class SessionUpdate(BaseModel):
    scheduled_at: datetime | None = None
    duration_min: int | None = Field(default=None, ge=5, le=480)
    status: SessionStatus | None = None
    mood_rating: int | None = Field(default=None, ge=1, le=10)
    dictation: str | None = None
    data: str | None = None
    assessment: str | None = None
    plan: str | None = None
    interventions: str | None = None
    homework: str | None = None
    risk_check: str | None = None
    private_note: str | None = None


class AddendumIn(BaseModel):
    text: str = Field(min_length=1)


class AddendumOut(ORM):
    id: int
    text: str
    created_at: UTC


class SessionOut(ORM):
    id: int
    client_id: int
    scheduled_at: datetime
    duration_min: int
    status: str
    mood_rating: int | None
    dictation: str | None
    data: str | None
    assessment: str | None
    plan: str | None
    interventions: str | None
    homework: str | None
    risk_check: str | None
    private_note: str | None
    note_status: str
    signed_at: UTC | None
    created_at: UTC
    updated_at: UTC
    addenda: list[AddendumOut] = []


class SessionWithClient(SessionOut):
    client_name: str


class DraftIn(BaseModel):
    dictation: str = Field(min_length=10, max_length=20000)


class DraftOut(BaseModel):
    data: str
    assessment: str
    plan: str
    interventions: str
    homework: str
    risk_indicators: list[str]
    ai_used: bool
    message: str | None = None


# ---------- assessments ----------
class AssessmentIn(BaseModel):
    kind: str
    answers: list[int]
    taken_at: datetime | None = None


class AssessmentOut(ORM):
    id: int
    kind: str
    answers: list[int]
    total: int
    severity: str
    flags: list[str]
    source: str = "counselor"
    taken_at: datetime


# ---------- goals ----------
class GoalIn(BaseModel):
    description: str = Field(min_length=1)


class GoalUpdate(BaseModel):
    description: str | None = None
    status: GoalStatus | None = None
    progress: int | None = Field(default=None, ge=0, le=100)


class GoalOut(ORM):
    id: int
    description: str
    status: str
    progress: int
    created_at: UTC
    updated_at: UTC


# ---------- brief / dashboard ----------
class BriefOut(BaseModel):
    summary: str | None
    ai_used: bool
    message: str | None = None
    last_session: datetime | None
    last_plan: str | None
    last_homework: str | None
    active_goals: list[str]
    latest_scores: list[dict]
    risk_level: str
    risk_notes: str | None
    open_flags: list[str]
    latest_checkin: dict | None = None


class DashboardOut(BaseModel):
    today: list[SessionWithClient]
    upcoming: list[SessionWithClient]
    unsigned: list[SessionWithClient]
    attention: list[dict]
    checkins: list[dict] = []
    counts: dict
    ai_enabled: bool


class AuditOut(ORM):
    id: int
    action: str
    entity: str
    entity_id: int | None
    detail: str | None
    at: UTC


# ---------- check-ins ----------
class CheckinCreate(BaseModel):
    kinds: list[str] = Field(min_length=1, max_length=4)
    days: int = Field(default=3, ge=1, le=14)


class CheckinOut(ORM):
    id: int
    kinds: list[str]
    expires_at: UTC
    completed_at: UTC | None
    revoked_at: UTC | None
    mood: int | None
    message: str | None
    created_at: UTC
    status: str = "pending"


class CheckinCreated(CheckinOut):
    token: str


class PublicCheckinOut(BaseModel):
    first_name: str
    counselor_name: str
    practice_name: str | None
    measures: list[dict]
    expires_at: UTC


class PublicCheckinIn(BaseModel):
    answers: dict[str, list[int]]
    mood: int | None = Field(default=None, ge=1, le=10)
    message: str | None = Field(default=None, max_length=4000)


class PublicCheckinResult(BaseModel):
    ok: bool
    show_support: bool


# ---------- letters ----------
LetterKind = Literal["attendance", "referral", "general"]


class LetterDraftIn(BaseModel):
    kind: LetterKind
    recipient: str | None = Field(default=None, max_length=500)
    reason: str | None = Field(default=None, max_length=2000)
    use_ai: bool = False


class LetterDraftOut(BaseModel):
    subject: str
    body: str
    ai_used: bool = False
    message: str | None = None


class LetterIn(BaseModel):
    kind: LetterKind
    recipient: str | None = Field(default=None, max_length=500)
    subject: str | None = Field(default=None, max_length=255)
    body: str = Field(min_length=1, max_length=20000)


class LetterUpdate(BaseModel):
    recipient: str | None = Field(default=None, max_length=500)
    subject: str | None = Field(default=None, max_length=255)
    body: str | None = Field(default=None, min_length=1, max_length=20000)


class LetterOut(ORM):
    id: int
    client_id: int
    kind: str
    recipient: str | None
    subject: str | None
    body: str
    created_at: UTC
    updated_at: UTC


class AuditEventIn(BaseModel):
    action: Literal["print"]
    entity: Literal["session", "client", "letter"]
    entity_id: int
