"""Offline field work.

A counsellor downloads a small "field pack" (their own active clients, upcoming groups and the
questionnaires) before going somewhere without signal. The browser encrypts it with a PIN and keeps
it for 72 hours. Work done offline queues on the device and is uploaded here when the connection
returns. Every queued item carries a UUID made on the device, so a retried upload never creates
duplicates.

Offline records arrive as drafts: notes still have to be read through and signed online.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import local_now
from ..db import get_db
from ..measures import MEASURES, MeasureError, public_definitions, score
from ..models import (
    Assessment, Client, CounselingSession, FieldSync, GroupAttendance, GroupSession, Organization, Programme, Therapist,
)
from ..schemas import Gender, RiskLevel, SessionSetting
from ..security import audit, client_scope, clinical_only
from .checkins import DEFAULT_SUPPORT
from .clients import _validate_assignment

router = APIRouter(prefix="/field", tags=["field"])

PACK_HOURS = 72
MAX_PACK_CLIENTS = 150
MAX_SYNC_ITEMS = 500


def _age(dob: date | None) -> int | None:
    if not dob:
        return None
    t = local_now().date()
    return t.year - dob.year - ((t.month, t.day) < (dob.month, dob.day))


@router.get("/pack")
def field_pack(db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    """The minimum needed to work offline: no background, private notes, email or full date of birth."""
    org = db.get(Organization, me.organization_id) if me.organization_id else None
    clients = db.scalars(
        select(Client)
        .where(client_scope(db, me), Client.therapist_id == me.id, Client.status == "active")
        .order_by(Client.full_name)
        .limit(MAX_PACK_CLIENTS)
    ).all()
    ids = [c.id for c in clients]
    last: dict[int, CounselingSession] = {}
    upcoming: dict[int, datetime] = {}
    now = local_now().replace(tzinfo=None)
    if ids:
        for s in db.scalars(select(CounselingSession).where(CounselingSession.client_id.in_(ids))
                            .order_by(CounselingSession.scheduled_at)):
            if s.status == "attended" and s.scheduled_at <= now:
                last[s.client_id] = s
            elif s.status == "scheduled" and s.scheduled_at >= now and s.client_id not in upcoming:
                upcoming[s.client_id] = s.scheduled_at

    window = (now - timedelta(days=7), now + timedelta(days=14))
    groups = db.scalars(
        select(GroupSession).where(
            GroupSession.organization_id == me.organization_id, GroupSession.facilitator_id == me.id,
            GroupSession.held_at >= window[0], GroupSession.held_at <= window[1], GroupSession.status != "cancelled",
        ).order_by(GroupSession.held_at)
    ).all()
    member_ids = {a.client_id for g in groups for a in g.attendance}
    names = dict(db.execute(select(Client.id, Client.full_name).where(Client.id.in_(member_ids))).all()) if member_ids else {}

    programmes = db.scalars(select(Programme).where(Programme.organization_id == me.organization_id,
                                                    Programme.active.is_(True))).all()
    audit(db, me, "field_pack", "therapist", me.id, f"{len(clients)} clients, {len(groups)} groups")
    db.commit()
    expires = datetime.now(timezone.utc) + timedelta(hours=PACK_HOURS)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": expires.isoformat(),
        "counsellor": {"id": me.id, "name": me.name},
        "organization": {"name": org.name if org else None, "country": org.country if org else "KE",
                         "crisis_contacts": (org.crisis_contacts if org and org.crisis_contacts else None)
                         or DEFAULT_SUPPORT.get(org.country if org else "KE", [])},
        "measures": [m | {"multiplier": MEASURES[m["kind"]].get("multiplier", 1)} for m in public_definitions()],
        "programmes": [{"id": p.id, "name": p.name} for p in programmes],
        "clients": [
            {
                "id": c.id, "full_name": c.full_name, "preferred_name": c.preferred_name, "age": _age(c.date_of_birth),
                "gender": c.gender, "phone": c.phone, "location": c.location, "settlement": c.settlement,
                "block": c.block, "unhcr_case_no": c.unhcr_case_no, "preferred_language": c.preferred_language,
                "interpreter_needed": c.interpreter_needed, "risk_level": c.risk_level, "risk_notes": c.risk_notes,
                "presenting_concern": c.presenting_concern, "consent_ai": c.consent_ai,
                "guardian_name": c.guardian_name, "guardian_phone": c.guardian_phone,
                "last_session_at": last[c.id].scheduled_at.isoformat() if c.id in last else None,
                "last_plan": last[c.id].plan if c.id in last else None,
                "last_homework": last[c.id].homework if c.id in last else None,
                "next_session_at": upcoming[c.id].isoformat() if c.id in upcoming else None,
            }
            for c in clients
        ],
        "groups": [
            {"id": g.id, "title": g.title, "held_at": g.held_at.isoformat(), "location": g.location,
             "members": sorted(({"client_id": a.client_id, "name": names.get(a.client_id, "?"), "present": a.present}
                                for a in g.attendance), key=lambda m: m["name"])}
            for g in groups
        ],
    }


# ---------- sync ----------
class FieldClientData(BaseModel):
    full_name: str = Field(min_length=1, max_length=160)
    preferred_name: str | None = Field(default=None, max_length=80)
    gender: Gender | None = None
    date_of_birth: date | None = None
    phone: str | None = Field(default=None, max_length=40)
    location: str | None = Field(default=None, max_length=120)
    settlement: str | None = Field(default=None, max_length=120)
    block: str | None = Field(default=None, max_length=60)
    unhcr_case_no: str | None = Field(default=None, max_length=40)
    preferred_language: str | None = Field(default=None, max_length=40)
    interpreter_needed: bool = False
    presenting_concern: str | None = Field(default=None, max_length=4000)
    risk_level: RiskLevel = "none"
    consent_signed: bool = False
    consent_ai: bool = False
    guardian_name: str | None = Field(default=None, max_length=160)
    guardian_phone: str | None = Field(default=None, max_length=40)
    guardian_consent: bool = False
    programme_id: int | None = None


class FieldSessionData(BaseModel):
    scheduled_at: datetime
    duration_min: int = Field(default=50, ge=5, le=480)
    status: Literal["attended", "no_show", "cancelled"] = "attended"
    setting: SessionSetting | None = None
    language: str | None = Field(default=None, max_length=40)
    interpreter_used: bool = False
    mood_rating: int | None = Field(default=None, ge=1, le=10)
    notes: str | None = Field(default=None, max_length=60000)
    data: str | None = Field(default=None, max_length=20000)
    assessment: str | None = Field(default=None, max_length=20000)
    plan: str | None = Field(default=None, max_length=20000)
    interventions: str | None = Field(default=None, max_length=20000)
    homework: str | None = Field(default=None, max_length=20000)
    risk_check: str | None = Field(default=None, max_length=20000)


class FieldAssessmentData(BaseModel):
    kind: str = Field(max_length=20)
    answers: list[int] = Field(max_length=40)
    taken_at: datetime


class FieldAttendanceData(BaseModel):
    group_id: int
    present: list[int] = Field(default_factory=list, max_length=500)  # client ids
    absent: list[int] = Field(default_factory=list, max_length=500)
    present_offline: list[str] = Field(default_factory=list, max_length=500)  # offline ids of new clients


UUID = Annotated[str, Field(pattern=r"^[0-9a-fA-F-]{36}$")]


class FieldItem(BaseModel):
    offline_id: UUID
    kind: Literal["client", "session", "assessment", "attendance"]
    client_id: int | None = None
    client_offline_id: UUID | None = None
    data: dict


class FieldSyncIn(BaseModel):
    items: list[FieldItem] = Field(max_length=MAX_SYNC_ITEMS)


class FieldResult(BaseModel):
    offline_id: str
    status: Literal["created", "duplicate", "error"]
    object_id: int | None = None
    message: str | None = None


class _Skip(Exception):
    pass


def _resolve_client(db: Session, me: Therapist, item: FieldItem, offline_map: dict[str, int]) -> Client:
    cid = item.client_id
    if item.client_offline_id:
        cid = offline_map.get(item.client_offline_id)
        if cid is None:
            fs = db.get(FieldSync, item.client_offline_id)
            if fs is None or fs.therapist_id != me.id or fs.kind != "client":
                raise _Skip("The new client this belongs to hasn't been uploaded yet.")
            cid = fs.object_id
    if cid is None:
        raise _Skip("No client given.")
    c = db.scalar(select(Client).where(Client.id == cid, client_scope(db, me)))
    if c is None:
        raise _Skip("You can't access this client any more.")
    return c


def _naive(dt: datetime) -> datetime:
    """Device times are local wall-clock times, like everything else in Kumbuka."""
    return dt.replace(tzinfo=None)


def _apply(db: Session, me: Therapist, item: FieldItem, offline_map: dict[str, int]) -> int:
    if item.kind == "client":
        d = FieldClientData.model_validate(item.data)
        _validate_assignment(db, me, None, d.programme_id)
        c = Client(organization_id=me.organization_id, therapist_id=me.id, referral_source="field",
                   **d.model_dump())
        db.add(c)
        db.flush()
        offline_map[item.offline_id] = c.id
        audit(db, me, "create", "client", c.id, "offline")
        return c.id

    if item.kind == "session":
        d = FieldSessionData.model_validate(item.data)
        c = _resolve_client(db, me, item, offline_map)
        fields = d.model_dump(exclude={"notes"})
        s = CounselingSession(therapist_id=me.id, client_id=c.id, dictation=d.notes, note_status="draft",
                              **(fields | {"scheduled_at": _naive(d.scheduled_at)}))
        db.add(s)
        db.flush()
        audit(db, me, "create", "session", s.id, "offline")
        return s.id

    if item.kind == "assessment":
        d = FieldAssessmentData.model_validate(item.data)
        c = _resolve_client(db, me, item, offline_map)
        try:
            r = score(d.kind, d.answers)
        except MeasureError as e:
            raise _Skip(str(e))
        a = Assessment(therapist_id=me.id, client_id=c.id, kind=d.kind, answers=d.answers, total=r["total"],
                       severity=r["severity"], flags=r["flags"], taken_at=_naive(d.taken_at))
        db.add(a)
        db.flush()
        audit(db, me, "create", "assessment", a.id, f"{d.kind}, offline")
        return a.id

    # attendance: merged into the register rather than replacing it, so two devices can't wipe each other
    d = FieldAttendanceData.model_validate(item.data)
    g = db.scalar(select(GroupSession).where(GroupSession.id == d.group_id,
                                             GroupSession.organization_id == me.organization_id,
                                             GroupSession.facilitator_id == me.id))
    if g is None:
        raise _Skip("Group session not found.")
    present = set(d.present)
    for oid in d.present_offline:
        cid = offline_map.get(oid)
        if cid is None:
            fs = db.get(FieldSync, oid)
            if fs is None or fs.therapist_id != me.id:
                raise _Skip("A new member in this register hasn't been uploaded yet.")
            cid = fs.object_id
        present.add(cid)
    wanted = present | set(d.absent)
    allowed = set(db.scalars(select(Client.id).where(Client.id.in_(wanted), client_scope(db, me))).all()) if wanted else set()
    if wanted - allowed:
        raise _Skip("Some members aren't clients you can access.")
    rows = {a.client_id: a for a in g.attendance}
    for cid in wanted:
        if cid in rows:
            rows[cid].present = cid in present
        else:
            g.attendance.append(GroupAttendance(client_id=cid, present=cid in present))
    if g.status == "scheduled":
        g.status = "held"
    db.flush()
    audit(db, me, "attendance", "group", g.id, f"{len(present)} present, offline")
    return g.id


@router.post("/sync", response_model=list[FieldResult])
def field_sync(body: FieldSyncIn, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    """Apply queued offline work in order. Each item succeeds or fails on its own."""
    results: list[FieldResult] = []
    offline_map: dict[str, int] = {}
    for item in body.items:
        done = db.get(FieldSync, item.offline_id)
        if done is not None:
            if done.therapist_id != me.id:
                results.append(FieldResult(offline_id=item.offline_id, status="error", message="Already used."))
            else:
                if done.kind == "client" and done.object_id:
                    offline_map[item.offline_id] = done.object_id
                results.append(FieldResult(offline_id=item.offline_id, status="duplicate", object_id=done.object_id))
            continue
        sp = db.begin_nested()
        try:
            object_id = _apply(db, me, item, offline_map)
            db.add(FieldSync(offline_id=item.offline_id, organization_id=me.organization_id, therapist_id=me.id,
                             kind=item.kind, object_id=object_id))
            sp.commit()
            results.append(FieldResult(offline_id=item.offline_id, status="created", object_id=object_id))
        except (_Skip, ValidationError, HTTPException) as e:
            sp.rollback()
            msg = (e.detail if isinstance(e, HTTPException) else
                   "Some details were invalid." if isinstance(e, ValidationError) else str(e))
            results.append(FieldResult(offline_id=item.offline_id, status="error", message=str(msg)[:300]))
    db.commit()
    return results
