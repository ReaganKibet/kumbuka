from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..config import local_now, settings
from ..db import get_db
from ..models import Assessment, AuditLog, CheckinLink, Client, CounselingSession, Therapist
from ..schemas import AuditOut, DashboardOut, SessionOut, SessionWithClient
from ..security import current_therapist

router = APIRouter(tags=["dashboard"])

S = CounselingSession


def _with_client(rows) -> list[SessionWithClient]:
    return [
        SessionWithClient(**SessionOut.model_validate(s).model_dump(), client_name=s.client.preferred_name or s.client.full_name)
        for s in rows
    ]


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    now = local_now()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    base = select(S).options(selectinload(S.client), selectinload(S.addenda)).where(S.therapist_id == me.id)

    today = db.scalars(
        base.where(S.scheduled_at >= day_start, S.scheduled_at < day_end).order_by(S.scheduled_at)
    ).all()
    upcoming = db.scalars(
        base.where(S.scheduled_at >= day_end, S.scheduled_at < day_end + timedelta(days=7), S.status == "scheduled")
        .order_by(S.scheduled_at)
    ).all()
    # Notes still in draft for sessions that have happened (or were marked attended).
    unsigned = db.scalars(
        base.where(
            S.note_status == "draft",
            S.status.in_(["attended", "scheduled"]),
            S.scheduled_at < now,
        ).order_by(S.scheduled_at)
    ).all()

    attention: list[dict] = []
    for c in db.scalars(
        select(Client).where(Client.therapist_id == me.id, Client.status == "active", Client.risk_level.in_(["medium", "high"]))
    ).all():
        attention.append({"client_id": c.id, "client_name": c.preferred_name or c.full_name,
                          "reason": f"Risk level: {c.risk_level}", "level": c.risk_level})
    recent_flagged = db.scalars(
        select(Assessment)
        .where(Assessment.therapist_id == me.id, Assessment.taken_at >= now - timedelta(days=14))
        .order_by(Assessment.taken_at.desc())
    ).all()
    seen = set()
    for a in recent_flagged:
        if a.flags and (a.client_id, a.kind) not in seen:
            seen.add((a.client_id, a.kind))
            c = db.get(Client, a.client_id)
            attention.append({"client_id": c.id, "client_name": c.preferred_name or c.full_name,
                              "reason": f"{a.kind} {a.total} ({a.severity}) on {a.taken_at:%d %b}: {a.flags[0]}",
                              "level": "flag"})

    # One entry per client, reasons combined.
    grouped: dict[int, dict] = {}
    for item in attention:
        g = grouped.setdefault(item["client_id"], {**item, "reasons": []})
        g["reasons"].append(item["reason"])
    attention = [{**g, "reason": "; ".join(g.pop("reasons"))} for g in grouped.values()]

    week_ago_utc = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)
    checkins = []
    for link in db.scalars(
        select(CheckinLink)
        .where(CheckinLink.therapist_id == me.id, CheckinLink.completed_at >= week_ago_utc)
        .order_by(CheckinLink.completed_at.desc())
    ).all():
        c = db.get(Client, link.client_id)
        scores = db.scalars(
            select(Assessment).where(Assessment.client_id == c.id, Assessment.source == "client")
            .order_by(Assessment.taken_at.desc()).limit(len(link.kinds))
        ).all()
        checkins.append({
            "client_id": c.id, "client_name": c.preferred_name or c.full_name,
            "completed_at": link.completed_at.isoformat() + "+00:00", "mood": link.mood,
            "has_message": bool(link.message),
            "scores": [f"{a.kind} {a.total} ({a.severity})" for a in scores],
            "flagged": any(a.flags for a in scores),
        })

    counts = {
        "active_clients": db.scalar(select(func.count(Client.id)).where(Client.therapist_id == me.id, Client.status == "active")) or 0,
        "sessions_this_month": db.scalar(
            select(func.count(S.id)).where(
                S.therapist_id == me.id, S.status == "attended", S.scheduled_at >= day_start.replace(day=1)
            )
        ) or 0,
    }

    return DashboardOut(
        today=_with_client(today),
        upcoming=_with_client(upcoming),
        unsigned=_with_client(unsigned),
        attention=attention,
        checkins=checkins,
        counts=counts,
        ai_enabled=settings.ai_enabled,
    )


@router.get("/audit", response_model=list[AuditOut])
def audit_log(db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    return db.scalars(
        select(AuditLog).where(AuditLog.therapist_id == me.id).order_by(AuditLog.at.desc()).limit(300)
    ).all()
