"""Supervision queue, referrals and group sessions."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..config import local_now
from ..db import get_db
from ..models import CLINICAL_ROLES, Client, CounselingSession, GroupAttendance, GroupSession, Programme, Referral, Therapist
from ..schemas import (
    AttendanceIn,
    AttendanceOut,
    ClientListItem,
    GroupIn,
    GroupOut,
    GroupUpdate,
    QuickMemberIn,
    ReferralIn,
    ReferralOut,
    ReferralUpdate,
)
from ..security import (
    audit,
    client_scope,
    clinical_only,
    current_therapist,
    is_admin,
    owned_client,
    require_roles,
    team_ids,
)
from .sessions import session_out

router = APIRouter(tags=["supervision, referrals, groups"])
S = CounselingSession

supervisors_only = require_roles("owner", "admin", "supervisor")


# ---------- supervision ----------
@router.get("/supervision")
def supervision(db: Session = Depends(get_db), me: Therapist = Depends(supervisors_only)):
    scope = client_scope(db, me)
    team = team_ids(db, me)
    review_q = (
        select(S).options(selectinload(S.addenda), selectinload(S.client))
        .join(Client, Client.id == S.client_id)
        .where(scope, S.note_status == "submitted", S.therapist_id != me.id)
        .order_by(S.signed_at)
    )
    if not is_admin(me):
        review_q = review_q.where(S.therapist_id.in_(team))
    pending = []
    for s in db.scalars(review_q).all():
        o = session_out(db, s, me).model_dump(mode="json")
        o["client_name"] = s.client.preferred_name or s.client.full_name
        o["client_id"] = s.client_id
        pending.append(o)

    def brief(c: Client) -> dict:
        counsellor = db.get(Therapist, c.therapist_id)
        return {
            "id": c.id, "name": c.preferred_name or c.full_name, "risk_level": c.risk_level,
            "counsellor_name": counsellor.name if counsellor else None,
            "escalated_at": c.escalated_at.isoformat() + "+00:00" if c.escalated_at else None,
            "escalation_note": c.escalation_note,
        }

    escalations = [brief(c) for c in db.scalars(
        select(Client).where(scope, Client.escalated_at.is_not(None)).order_by(Client.escalated_at)
    ).all()]
    high_risk = [brief(c) for c in db.scalars(
        select(Client).where(scope, Client.status == "active", Client.risk_level == "high").order_by(Client.full_name)
    ).all()]

    member_q = select(Therapist).where(Therapist.organization_id == me.organization_id, Therapist.active.is_(True),
                                       Therapist.role.in_(CLINICAL_ROLES), Therapist.id != me.id)
    if not is_admin(me):
        member_q = member_q.where(Therapist.supervisor_id == me.id)
    now = local_now()
    team_rows = []
    for t in db.scalars(member_q.order_by(Therapist.name)).all():
        caseload = db.scalar(select(func.count(Client.id)).where(Client.therapist_id == t.id, Client.status == "active")) or 0
        overdue = db.scalar(select(func.count(S.id)).where(
            S.therapist_id == t.id, S.note_status == "draft", S.status.in_(["attended", "scheduled"]),
            S.scheduled_at < now - timedelta(days=2),
        )) or 0
        month = db.scalar(select(func.count(S.id)).where(
            S.therapist_id == t.id, S.status == "attended", S.scheduled_at >= now - timedelta(days=30),
        )) or 0
        team_rows.append({"id": t.id, "name": t.name, "role": t.role, "caseload": caseload,
                          "overdue_notes": overdue, "sessions_30d": month})
    return {"pending_reviews": pending, "escalations": escalations, "high_risk": high_risk, "team": team_rows}


# ---------- referrals ----------
def _referral_out(db: Session, r: Referral) -> ReferralOut:
    o = ReferralOut.model_validate(r)
    c = db.get(Client, r.client_id)
    o.client_name = (c.preferred_name or c.full_name) if c else None
    by = db.get(Therapist, r.created_by_id)
    o.created_by_name = by.name if by else None
    o.overdue = bool(r.follow_up_on and r.follow_up_on < local_now().date() and r.status in ("made", "accepted"))
    return o


@router.get("/referrals", response_model=list[ReferralOut])
def list_referrals(
    open_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    me: Therapist = Depends(clinical_only),
):
    q = select(Referral).join(Client, Client.id == Referral.client_id).where(client_scope(db, me))
    if open_only:
        q = q.where(Referral.status.in_(["made", "accepted"]))
    rows = db.scalars(q.order_by(Referral.referred_on.desc(), Referral.id.desc()).limit(500)).all()
    return [_referral_out(db, r) for r in rows]


@router.get("/clients/{client_id}/referrals", response_model=list[ReferralOut])
def client_referrals(client_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    client = owned_client(db, client_id, me)
    rows = db.scalars(select(Referral).where(Referral.client_id == client.id).order_by(Referral.referred_on.desc())).all()
    return [_referral_out(db, r) for r in rows]


@router.post("/clients/{client_id}/referrals", response_model=ReferralOut, status_code=201)
def create_referral(client_id: int, body: ReferralIn, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    client = owned_client(db, client_id, me)
    data = body.model_dump()
    data["referred_on"] = data["referred_on"] or local_now().date()
    if data["follow_up_on"] is None:
        data["follow_up_on"] = data["referred_on"] + timedelta(days={"emergency": 1, "urgent": 3}.get(body.urgency, 14))
    r = Referral(organization_id=me.organization_id, client_id=client.id, created_by_id=me.id, **data)
    db.add(r)
    db.flush()
    audit(db, me, "create", "referral", r.id, body.service)
    db.commit()
    return _referral_out(db, r)


@router.patch("/referrals/{referral_id}", response_model=ReferralOut)
def update_referral(referral_id: int, body: ReferralUpdate, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    r = db.get(Referral, referral_id)
    if r is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Referral not found")
    owned_client(db, r.client_id, me)
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(r, k, v)
    audit(db, me, "update", "referral", r.id, ", ".join(sorted(changes))[:255])
    db.commit()
    return _referral_out(db, r)


# ---------- group sessions ----------
def _group_scope(db: Session, me: Therapist):
    in_org = GroupSession.organization_id == me.organization_id
    if is_admin(me):
        return in_org
    if me.role == "supervisor":
        return in_org & GroupSession.facilitator_id.in_(team_ids(db, me))
    return in_org & (GroupSession.facilitator_id == me.id)


def _owned_group(db: Session, group_id: int, me: Therapist) -> GroupSession:
    g = db.scalar(select(GroupSession).options(selectinload(GroupSession.attendance).selectinload(GroupAttendance.client))
                  .where(GroupSession.id == group_id, _group_scope(db, me)))
    if g is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group session not found")
    return g


def _group_out(db: Session, g: GroupSession, me: Therapist, with_attendance: bool = True) -> GroupOut:
    o = GroupOut(**{f: getattr(g, f) for f in (
        "id", "title", "topic", "location", "programme_id", "facilitator_id", "held_at", "duration_min", "status", "notes")})
    fac = db.get(Therapist, g.facilitator_id)
    o.facilitator_name = fac.name if fac else None
    if g.programme_id:
        p = db.get(Programme, g.programme_id)
        o.programme_name = p.name if p else None
    o.registered_count = len(g.attendance)
    o.present_count = sum(1 for a in g.attendance if a.present)
    o.can_edit = g.facilitator_id == me.id or is_admin(me) or (
        me.role == "supervisor" and g.facilitator_id in team_ids(db, me))
    if with_attendance:
        o.attendance = sorted(
            (AttendanceOut(client_id=a.client_id, client_name=a.client.full_name, present=a.present, note=a.note)
             for a in g.attendance),
            key=lambda a: a.client_name.lower(),
        )
    return o


@router.get("/groups", response_model=list[GroupOut])
def list_groups(programme_id: int | None = None, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    q = select(GroupSession).options(selectinload(GroupSession.attendance)).where(_group_scope(db, me))
    if programme_id:
        q = q.where(GroupSession.programme_id == programme_id)
    return [_group_out(db, g, me, with_attendance=False) for g in db.scalars(q.order_by(GroupSession.held_at.desc()).limit(300))]


@router.post("/groups", response_model=GroupOut, status_code=201)
def create_group(body: GroupIn, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    facilitator = body.facilitator_id or me.id
    if facilitator != me.id:
        f = db.get(Therapist, facilitator)
        if f is None or f.organization_id != me.organization_id or not (is_admin(me) or facilitator in team_ids(db, me)):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose a facilitator in your team.")
    if body.programme_id:
        p = db.get(Programme, body.programme_id)
        if p is None or p.organization_id != me.organization_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown programme.")
    g = GroupSession(organization_id=me.organization_id, facilitator_id=facilitator,
                     **body.model_dump(exclude={"facilitator_id", "held_at"}), held_at=body.held_at.replace(tzinfo=None))
    db.add(g)
    db.flush()
    audit(db, me, "create", "group", g.id)
    db.commit()
    return _group_out(db, _owned_group(db, g.id, me), me)


@router.get("/groups/{group_id}", response_model=GroupOut)
def get_group(group_id: int, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    g = _owned_group(db, group_id, me)
    audit(db, me, "view", "group", g.id)
    db.commit()
    return _group_out(db, g, me)


@router.patch("/groups/{group_id}", response_model=GroupOut)
def update_group(group_id: int, body: GroupUpdate, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    g = _owned_group(db, group_id, me)
    changes = body.model_dump(exclude_unset=True)
    if changes.get("held_at"):
        changes["held_at"] = changes["held_at"].replace(tzinfo=None)
    if changes.get("programme_id"):
        p = db.get(Programme, changes["programme_id"])
        if p is None or p.organization_id != me.organization_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown programme.")
    for k, v in changes.items():
        setattr(g, k, v)
    audit(db, me, "update", "group", g.id)
    db.commit()
    return _group_out(db, _owned_group(db, g.id, me), me)


@router.delete("/groups/{group_id}", status_code=204)
def delete_group(group_id: int, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    g = _owned_group(db, group_id, me)
    audit(db, me, "delete", "group", g.id)
    db.delete(g)
    db.commit()


@router.put("/groups/{group_id}/attendance", response_model=GroupOut)
def set_attendance(group_id: int, body: list[AttendanceIn], db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    """Replace the whole register. Members must be clients you can open."""
    g = _owned_group(db, group_id, me)
    ids = {a.client_id for a in body}
    allowed = set(db.scalars(select(Client.id).where(Client.id.in_(ids), client_scope(db, me))).all()) if ids else set()
    if ids - allowed:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Some members aren't clients you can access.")
    g.attendance.clear()
    db.flush()
    for a in body:
        g.attendance.append(GroupAttendance(client_id=a.client_id, present=a.present, note=(a.note or "").strip() or None))
    audit(db, me, "attendance", "group", g.id, f"{sum(a.present for a in body)} present of {len(body)}")
    db.commit()
    db.expire(g)
    return _group_out(db, _owned_group(db, g.id, me), me)


@router.post("/groups/{group_id}/members", response_model=ClientListItem, status_code=201)
def quick_add_member(group_id: int, body: QuickMemberIn, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    """Register a new participant straight from the group register (e.g. a student in a school group)."""
    g = _owned_group(db, group_id, me)
    c = Client(organization_id=me.organization_id, therapist_id=g.facilitator_id, programme_id=g.programme_id,
               full_name=body.full_name.strip(), gender=body.gender, date_of_birth=body.date_of_birth,
               location=body.location or g.location, referral_source="group")
    db.add(c)
    db.flush()
    audit(db, me, "create", "client", c.id, f"from group {g.id}")
    db.commit()
    return ClientListItem(id=c.id, full_name=c.full_name, preferred_name=None, risk_level=c.risk_level, status=c.status)

