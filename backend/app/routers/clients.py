from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from ..ai import write_brief
from ..config import local_now
from ..db import get_db
from ..models import Assessment, CheckinLink, Client, CounselingSession, Goal, Letter, Therapist
from ..schemas import (
    AssessmentOut,
    BriefOut,
    ClientCreate,
    ClientListItem,
    ClientOut,
    ClientUpdate,
    GoalOut,
    LetterOut,
    SessionOut,
)
from ..security import audit, current_therapist, owned_client

router = APIRouter(prefix="/clients", tags=["clients"])

S = CounselingSession


@router.get("", response_model=list[ClientListItem])
def list_clients(
    status: str | None = Query(default=None, description="active | paused | closed"),
    db: Session = Depends(get_db),
    me: Therapist = Depends(current_therapist),
):
    now = local_now()
    last_q = (
        select(S.client_id, func.max(S.scheduled_at).label("v"))
        .where(S.therapist_id == me.id, S.status == "attended")
        .group_by(S.client_id)
        .subquery()
    )
    next_q = (
        select(S.client_id, func.min(S.scheduled_at).label("v"))
        .where(S.therapist_id == me.id, S.status == "scheduled", S.scheduled_at >= now)
        .group_by(S.client_id)
        .subquery()
    )
    count_q = (
        select(
            S.client_id,
            func.count(S.id).label("total"),
            func.sum(case((and_(S.status == "attended", S.note_status == "draft"), 1), else_=0)).label("unsigned"),
        )
        .where(S.therapist_id == me.id)
        .group_by(S.client_id)
        .subquery()
    )

    q = (
        select(Client, last_q.c.v, next_q.c.v, count_q.c.total, count_q.c.unsigned)
        .outerjoin(last_q, last_q.c.client_id == Client.id)
        .outerjoin(next_q, next_q.c.client_id == Client.id)
        .outerjoin(count_q, count_q.c.client_id == Client.id)
        .where(Client.therapist_id == me.id)
        .order_by(Client.full_name)
    )
    if status:
        q = q.where(Client.status == status)

    return [
        ClientListItem(
            id=c.id,
            full_name=c.full_name,
            preferred_name=c.preferred_name,
            risk_level=c.risk_level,
            status=c.status,
            last_session=last,
            next_session=nxt,
            session_count=total or 0,
            unsigned_notes=int(unsigned or 0),
        )
        for c, last, nxt, total, unsigned in db.execute(q).all()
    ]


@router.post("", response_model=ClientOut, status_code=201)
def create_client(body: ClientCreate, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    client = Client(therapist_id=me.id, **body.model_dump())
    db.add(client)
    db.flush()
    audit(db, me, "create", "client", client.id)
    db.commit()
    return client


@router.get("/{client_id}", response_model=ClientOut)
def get_client(client_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    client = owned_client(db, client_id, me)
    audit(db, me, "view", "client", client.id)
    db.commit()
    return client


@router.patch("/{client_id}", response_model=ClientOut)
def update_client(
    client_id: int, body: ClientUpdate, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)
):
    client = owned_client(db, client_id, me)
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(client, k, v)
    audit(db, me, "update", "client", client.id, ", ".join(sorted(changes))[:255])
    db.commit()
    return client


@router.get("/{client_id}/brief", response_model=BriefOut)
def client_brief(
    client_id: int,
    ai: bool = Query(default=True),
    db: Session = Depends(get_db),
    me: Therapist = Depends(current_therapist),
):
    client = owned_client(db, client_id, me)

    recent = db.scalars(
        select(S)
        .where(S.client_id == client.id, S.status == "attended")
        .order_by(S.scheduled_at.desc())
        .limit(4)
    ).all()
    goals = db.scalars(select(Goal).where(Goal.client_id == client.id, Goal.status == "active")).all()

    latest_scores: list[dict] = []
    open_flags: list[str] = []
    for kind in ("PHQ-9", "GAD-7"):
        rows = db.scalars(
            select(Assessment)
            .where(Assessment.client_id == client.id, Assessment.kind == kind)
            .order_by(Assessment.taken_at.desc())
            .limit(2)
        ).all()
        if rows:
            latest, prev = rows[0], (rows[1] if len(rows) > 1 else None)
            latest_scores.append(
                {
                    "kind": kind,
                    "total": latest.total,
                    "severity": latest.severity,
                    "taken_at": latest.taken_at.isoformat(),
                    "change": (latest.total - prev.total) if prev else None,
                }
            )
            open_flags += [f"{kind} on {latest.taken_at:%d %b}: {f}" for f in latest.flags]

    last = recent[0] if recent else None
    checkin = db.scalar(
        select(CheckinLink)
        .where(CheckinLink.client_id == client.id, CheckinLink.completed_at.is_not(None))
        .order_by(CheckinLink.completed_at.desc())
        .limit(1)
    )
    latest_checkin = (
        {"completed_at": checkin.completed_at.isoformat() + "+00:00", "mood": checkin.mood, "message": checkin.message,
         "kinds": checkin.kinds}
        if checkin else None
    )

    summary, message = None, None
    if ai and (recent or latest_scores or goals or client.presenting_concern):
        if not client.consent_ai:
            message = "AI summary is off for this client because they have not consented to AI-assisted notes."
        else:
            # Only clinical content goes to the model: no names, contacts or dates of birth.
            parts = [f"Presenting concern: {client.presenting_concern or 'not recorded'}"]
            if client.risk_level != "none" or client.risk_notes:
                parts.append(f"Risk level set by counselor: {client.risk_level}. Risk notes: {client.risk_notes or '-'}")
            if goals:
                parts.append("Active goals: " + "; ".join(f"{g.description} ({g.progress}% progress)" for g in goals))
            for s in reversed(recent):
                parts.append(
                    f"Session on {s.scheduled_at:%Y-%m-%d}"
                    + (f", client mood {s.mood_rating}/10" if s.mood_rating else "")
                    + f"\nData: {s.data or '-'}\nAssessment: {s.assessment or '-'}\nPlan: {s.plan or '-'}"
                    + f"\nHomework: {s.homework or '-'}\nRisk check: {s.risk_check or '-'}"
                )
            for sc in latest_scores:
                ch = "" if sc["change"] is None else f" (change since previous: {sc['change']:+d})"
                parts.append(f"{sc['kind']}: {sc['total']} - {sc['severity']}{ch}")
            if open_flags:
                parts.append("Questionnaire flags: " + "; ".join(open_flags))
            if checkin and (checkin.message or checkin.mood):
                parts.append(
                    f"Client's own check-in on {checkin.completed_at:%Y-%m-%d}: mood {checkin.mood or '-'}/10. "
                    f"Message from client: {checkin.message or '-'}"
                )
            summary, message = write_brief("\n\n".join(parts))
            audit(db, me, "ai_brief", "client", client.id)

    audit(db, me, "view_brief", "client", client.id)
    db.commit()

    return BriefOut(
        summary=summary,
        ai_used=summary is not None,
        message=message,
        last_session=last.scheduled_at if last else None,
        last_plan=last.plan if last else None,
        last_homework=last.homework if last else None,
        active_goals=[g.description for g in goals],
        latest_scores=latest_scores,
        risk_level=client.risk_level,
        risk_notes=client.risk_notes,
        open_flags=open_flags,
        latest_checkin=latest_checkin,
    )


@router.get("/{client_id}/export")
def export_client(client_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    """Full record for a client access request. Private counselor notes are excluded."""
    client = owned_client(db, client_id, me)
    sessions = db.scalars(select(S).where(S.client_id == client.id).order_by(S.scheduled_at)).all()
    assessments = db.scalars(
        select(Assessment).where(Assessment.client_id == client.id).order_by(Assessment.taken_at)
    ).all()
    goals = db.scalars(select(Goal).where(Goal.client_id == client.id).order_by(Goal.created_at)).all()
    letters = db.scalars(select(Letter).where(Letter.client_id == client.id).order_by(Letter.created_at)).all()
    audit(db, me, "export", "client", client.id)
    db.commit()
    return {
        "exported_at": local_now().isoformat(),
        "client": ClientOut.model_validate(client).model_dump(mode="json"),
        "sessions": [
            SessionOut.model_validate(s).model_dump(mode="json", exclude={"private_note", "dictation"})
            for s in sessions
        ],
        "assessments": [AssessmentOut.model_validate(a).model_dump(mode="json") for a in assessments],
        "goals": [GoalOut.model_validate(g).model_dump(mode="json") for g in goals],
        "letters": [LetterOut.model_validate(x).model_dump(mode="json") for x in letters],
    }
