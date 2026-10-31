from datetime import date, datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, PlainSerializer

# System timestamps (created, signed, audit) are stored as naive UTC; send them with a
# timezone so browsers convert them to local time. Appointment times (scheduled_at,
# taken_at) are already the counselor's local wall-clock time and are sent as-is.
UTC = Annotated[datetime, PlainSerializer(lambda d: d.replace(tzinfo=timezone.utc).isoformat(), return_type=str)]

RiskLevel = Literal["none", "low", "medium", "high"]
Gender = Literal["female", "male", "other", "undisclosed"]
ClientStatus = Literal["active", "paused", "closed"]
SessionStatus = Literal["scheduled", "attended", "cancelled", "no_show"]
GoalStatus = Literal["active", "achieved", "dropped"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- auth ----------
PASSWORD = Field(min_length=10, max_length=200)


OrgKind = Literal["ngo", "school", "university", "counselling_centre", "private_practice", "faith_based", "government", "other"]
Role = Literal["owner", "admin", "supervisor", "counsellor", "lay_counsellor", "me_officer"]


class RegisterIn(BaseModel):
    """Creates a new organization and its owner account."""
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = PASSWORD
    organization_name: str | None = Field(default=None, max_length=200)
    organization_kind: OrgKind = "private_practice"
    country: str = Field(default="KE", min_length=2, max_length=2)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)


class MfaIn(BaseModel):
    mfa_token: str
    code: str = Field(min_length=6, max_length=20)  # 6-digit app code or a recovery code


class OrgOut(ORM):
    id: int
    name: str
    kind: str
    country: str
    review_all_notes: bool
    crisis_contacts: list[dict] | None = None
    is_demo: bool = False


class TherapistOut(ORM):
    id: int
    name: str
    email: str
    role: str = "owner"
    organization_id: int | None = None
    supervisor_id: int | None = None
    organization: OrgOut | None = None
    title: str | None = None
    practice_name: str | None = None
    phone: str | None = None
    address: str | None = None
    license_no: str | None = None
    totp_enabled: bool = False
    recovery_codes_left: int = 0
    ai_available: bool = False  # AI may be used on this person's client records
    can_transcribe: bool = False


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
    demo_enabled: bool = False
    ai_provider: str | None = None
    ai_real_data: bool = False  # False on a free Gemini key: AI only in the demo and on anonymised reports


class DemoLoginIn(BaseModel):
    role: Literal["director", "supervisor", "counsellor", "lay", "me"]


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
    programme_id: int | None = None
    gender: Gender | None = None
    location: str | None = Field(default=None, max_length=120)
    referral_source: str | None = Field(default=None, max_length=60)
    guardian_name: str | None = None
    guardian_phone: str | None = None
    guardian_consent: bool = False
    restricted: bool = False


class ClientCreate(ClientBase):
    therapist_id: int | None = None  # assign to a counsellor (admins and supervisors)


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
    programme_id: int | None = None
    gender: Gender | None = None
    location: str | None = None
    referral_source: str | None = None
    guardian_name: str | None = None
    guardian_phone: str | None = None
    guardian_consent: bool | None = None
    restricted: bool | None = None
    therapist_id: int | None = None


class ClientOut(ClientBase, ORM):
    id: int
    therapist_id: int
    counsellor_name: str | None = None
    programme_name: str | None = None
    escalated_at: UTC | None = None
    escalation_note: str | None = None
    created_at: UTC
    updated_at: UTC


class EscalateIn(BaseModel):
    note: str = Field(min_length=1, max_length=4000)


class ClientListItem(ORM):
    id: int
    full_name: str
    preferred_name: str | None
    risk_level: str
    status: str
    restricted: bool = False
    escalated: bool = False
    counsellor_name: str | None = None
    programme_name: str | None = None
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
    review_status: str = "none"
    review_comment: str | None = None
    reviewed_at: UTC | None = None
    author_id: int | None = None
    author_name: str | None = None
    reviewer_name: str | None = None
    can_edit: bool = False
    can_review: bool = False
    created_at: UTC
    updated_at: UTC
    addenda: list[AddendumOut] = []


class ReviewIn(BaseModel):
    decision: Literal["approve", "return"]
    comment: str | None = Field(default=None, max_length=4000)


class SessionWithClient(SessionOut):
    client_name: str


class DraftIn(BaseModel):
    dictation: str = Field(min_length=10, max_length=60000)  # a full-session transcript can be long


class TranscriptOut(BaseModel):
    transcript: str
    seconds: int | None = None


class NarrativeOut(BaseModel):
    narrative: str


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
    supervision: dict | None = None


class AuditOut(ORM):
    id: int
    actor_name: str | None = None
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
    country: str = "KE"
    support_contacts: list[dict] = []


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


# ---------- organization ----------
class CrisisContact(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    number: str = Field(min_length=2, max_length=40)
    note: str | None = Field(default=None, max_length=200)


class OrgUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: OrgKind | None = None
    country: str | None = Field(default=None, min_length=2, max_length=2)
    review_all_notes: bool | None = None
    crisis_contacts: list[CrisisContact] | None = None


class ProgrammeIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    funder: str | None = Field(default=None, max_length=200)
    active: bool = True


class ProgrammeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    funder: str | None = Field(default=None, max_length=200)
    active: bool | None = None


class ProgrammeOut(ORM):
    id: int
    name: str
    location: str | None
    funder: str | None
    active: bool


class MemberOut(ORM):
    id: int
    name: str
    email: str
    role: str
    title: str | None = None
    supervisor_id: int | None
    active: bool
    totp_enabled: bool = False
    caseload: int = 0


class MemberUpdate(BaseModel):
    role: Role | None = None
    supervisor_id: int | None = None
    active: bool | None = None
    clear_supervisor: bool = False


class InviteIn(BaseModel):
    email: EmailStr
    name: str | None = Field(default=None, max_length=120)
    role: Role
    supervisor_id: int | None = None
    days: int = Field(default=7, ge=1, le=30)


class InviteOut(ORM):
    id: int
    email: str
    name: str | None
    role: str
    supervisor_id: int | None
    expires_at: UTC
    accepted_at: UTC | None
    revoked_at: UTC | None
    created_at: UTC
    status: str = "pending"


class InviteCreated(InviteOut):
    token: str


class PublicInviteOut(BaseModel):
    organization_name: str
    email: str
    name: str | None
    role: str


class AcceptInviteIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    password: str = PASSWORD


class TransferIn(BaseModel):
    from_id: int
    to_id: int


# ---------- referrals ----------
Service = Literal["medical", "psychiatric", "legal", "protection", "gbv", "education", "economic", "social", "other"]
ReferralStatus = Literal["made", "accepted", "attended", "not_attended", "declined", "closed"]


class ReferralIn(BaseModel):
    service: Service
    to_organisation: str | None = Field(default=None, max_length=200)
    to_contact: str | None = Field(default=None, max_length=200)
    reason: str | None = Field(default=None, max_length=4000)
    urgency: Literal["routine", "urgent", "emergency"] = "routine"
    referred_on: date | None = None
    follow_up_on: date | None = None


class ReferralUpdate(BaseModel):
    status: ReferralStatus | None = None
    outcome: str | None = Field(default=None, max_length=4000)
    follow_up_on: date | None = None
    to_organisation: str | None = None
    to_contact: str | None = None


class ReferralOut(ORM):
    id: int
    client_id: int
    client_name: str | None = None
    created_by_name: str | None = None
    service: str
    to_organisation: str | None
    to_contact: str | None
    reason: str | None
    urgency: str
    status: str
    outcome: str | None
    referred_on: date
    follow_up_on: date | None
    overdue: bool = False
    created_at: UTC
    updated_at: UTC


# ---------- groups ----------
class GroupIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    topic: str | None = Field(default=None, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    programme_id: int | None = None
    held_at: datetime
    duration_min: int = Field(default=60, ge=5, le=480)
    status: Literal["scheduled", "held", "cancelled"] = "held"
    notes: str | None = None
    facilitator_id: int | None = None


class GroupUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    topic: str | None = None
    location: str | None = None
    programme_id: int | None = None
    held_at: datetime | None = None
    duration_min: int | None = Field(default=None, ge=5, le=480)
    status: Literal["scheduled", "held", "cancelled"] | None = None
    notes: str | None = None


class AttendanceIn(BaseModel):
    client_id: int
    present: bool = True
    note: str | None = Field(default=None, max_length=2000)


class AttendanceOut(BaseModel):
    client_id: int
    client_name: str
    present: bool
    note: str | None


class GroupOut(ORM):
    id: int
    title: str
    topic: str | None
    location: str | None
    programme_id: int | None
    programme_name: str | None = None
    facilitator_id: int
    facilitator_name: str | None = None
    held_at: datetime
    duration_min: int
    status: str
    notes: str | None
    present_count: int = 0
    registered_count: int = 0
    attendance: list[AttendanceOut] = []
    can_edit: bool = False


class QuickMemberIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    gender: Gender | None = None
    date_of_birth: date | None = None
    location: str | None = Field(default=None, max_length=120)
