from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session, aliased

from ..ai import write_brief
from ..config import local_now, settings
from ..db import get_db
from ..models import CLINICAL_ROLES, Assessment, CheckinLink, Client, CounselingSession, Goal, Letter, Organization, Programme, Therapist, utcnow
from ..schemas import (
    AssessmentOut,
    BriefOut,
    ClientCreate,
    ClientListItem,
    ClientOut,
    ClientUpdate,
    EscalateIn,
    GoalOut,
    LetterOut,
    SessionOut,
)
from ..security import audit, client_scope, clinical_only, current_therapist, is_admin, owned_client, team_ids

router = APIRouter(prefix="/clients", tags=["clients"])

S = CounselingSession


def _validate_assignment(db: Session, me: Therapist, therapist_id: int | None, programme_id: int | None):
    if therapist_id is not None and therapist_id != me.id:
        if not (is_admin(me) or me.role == "supervisor"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only supervisors and admins can assign clients to others.")
        target = db.get(Therapist, therapist_id)
        if target is None or target.organization_id != me.organization_id or not target.active \
                or target.role not in CLINICAL_ROLES:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose an active counsellor in your organization.")
        if me.role == "supervisor" and therapist_id not in team_ids(db, me):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Supervisors can assign clients only within their team.")
    if programme_id is not None:
        prog = db.get(Programme, programme_id)
        if prog is None or prog.organization_id != me.organization_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown programme.")


def client_out(db: Session, c: Client) -> ClientOut:
    out = ClientOut.model_validate(c)
    counsellor = db.get(Therapist, c.therapist_id)
    out.counsellor_name = counsellor.name if counsellor else None
    if c.programme_id:
        prog = db.get(Programme, c.programme_id)
        out.programme_name = prog.name if prog else None
    return out


@router.get("", response_model=list[ClientListItem])
def list_clients(
    status: str | None = Query(default=None, description="active | paused | closed"),
    programme_id: int | None = None,
    counsellor_id: int | None = None,
    db: Session = Depends(get_db),
    me: Therapist = Depends(current_therapist),
):
    now = local_now()
    last_q = (
        select(S.client_id, func.max(S.scheduled_at).label("v"))
        .where(S.status == "attended")
        .group_by(S.client_id)
        .subquery()
    )
    next_q = (
        select(S.client_id, func.min(S.scheduled_at).label("v"))
        .where(S.status == "scheduled", S.scheduled_at >= now)
        .group_by(S.client_id)
        .subquery()
    )
    count_q = (
        select(
            S.client_id,
            func.count(S.id).label("total"),
            func.sum(case((and_(S.status == "attended", S.note_status == "draft"), 1), else_=0)).label("unsigned"),
        )
        .group_by(S.client_id)
        .subquery()
    )
    Counsellor = aliased(Therapist)
    q = (
        select(Client, last_q.c.v, next_q.c.v, count_q.c.total, count_q.c.unsigned, Counsellor.name, Programme.name)
        .outerjoin(last_q, last_q.c.client_id == Client.id)
        .outerjoin(next_q, next_q.c.client_id == Client.id)
        .outerjoin(count_q, count_q.c.client_id == Client.id)
        .outerjoin(Counsellor, Counsellor.id == Client.therapist_id)
        .outerjoin(Programme, Programme.id == Client.programme_id)
        .where(client_scope(db, me))
        .order_by(Client.full_name)
    )
    if status:
        q = q.where(Client.status == status)
    if programme_id:
        q = q.where(Client.programme_id == programme_id)
    if counsellor_id:
        q = q.where(Client.therapist_id == counsellor_id)

    return [
        ClientListItem(
            id=c.id,
            full_name=c.full_name,
            preferred_name=c.preferred_name,
            risk_level=c.risk_level,
            status=c.status,
            restricted=c.restricted,
            escalated=c.escalated_at is not None,
            counsellor_name=cname,
            programme_name=pname,
            last_session=last,
            next_session=nxt,
            session_count=total or 0,
            unsigned_notes=int(unsigned or 0),
        )
        for c, last, nxt, total, unsigned, cname, pname in db.execute(q).all()
    ]


@router.post("", response_model=ClientOut, status_code=201)
def create_client(body: ClientCreate, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    _validate_assignment(db, me, body.therapist_id, body.programme_id)
    data = body.model_dump(exclude={"therapist_id"})
    client = Client(organization_id=me.organization_id, therapist_id=body.therapist_id or me.id, **data)
    db.add(client)
    db.flush()
    audit(db, me, "create", "client", client.id)
    db.commit()
    return client_out(db, client)


@router.get("/{client_id}", response_model=ClientOut)
def get_client(client_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    client = owned_client(db, client_id, me)
    audit(db, me, "view", "client", client.id)
    db.commit()
    return client_out(db, client)


@router.patch("/{client_id}", response_model=ClientOut)
def update_client(
    client_id: int, body: ClientUpdate, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)
):
    client = owned_client(db, client_id, me)
    changes = body.model_dump(exclude_unset=True)
    if "therapist_id" in changes:
        if changes["therapist_id"] is None:
            changes.pop("therapist_id")
        else:
            _validate_assignment(db, me, changes["therapist_id"], None)
    if changes.get("programme_id") is not None:
        _validate_assignment(db, me, None, changes["programme_id"])
    for k, v in changes.items():
        setattr(client, k, v)
    audit(db, me, "update", "client", client.id, ", ".join(sorted(changes))[:255])
    db.commit()
    return client_out(db, client)


@router.post("/{client_id}/escalate", response_model=ClientOut)
def escalate(client_id: int, body: EscalateIn, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    """A counsellor (often a lay counsellor) asks their supervisor for clinical support with this client."""
    client = owned_client(db, client_id, me)
    client.escalated_at = utcnow()
    client.escalation_note = body.note.strip()
    client.escalated_by_id = me.id
    audit(db, me, "escalate", "client", client.id)
    db.commit()
    return client_out(db, client)


@router.post("/{client_id}/escalation/resolve", response_model=ClientOut)
def resolve_escalation(client_id: int, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    client = owned_client(db, client_id, me)
    if client.escalated_at is None:
        return client_out(db, client)
    if not (is_admin(me) or me.role == "supervisor"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "A supervisor or admin closes escalations.")
    client.escalated_at = None
    audit(db, me, "resolve_escalation", "client", client.id, (client.escalation_note or "")[:255])
    client.escalation_note = None
    client.escalated_by_id = None
    db.commit()
    return client_out(db, client)


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
    for kind in ("PHQ-9", "GAD-7", "WHO-5"):
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
            org = db.get(Organization, me.organization_id) if me.organization_id else None
            summary, message = write_brief("\n\n".join(parts), allowed=settings.ai_allowed_for(org))
            if summary:
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
        "client": client_out(db, client).model_dump(mode="json"),
        "sessions": [
            SessionOut.model_validate(s).model_dump(mode="json", exclude={"private_note", "dictation"})
            for s in sessions
        ],
        "assessments": [AssessmentOut.model_validate(a).model_dump(mode="json") for a in assessments],
        "goals": [GoalOut.model_validate(g).model_dump(mode="json") for g in goals],
        "letters": [LetterOut.model_validate(x).model_dump(mode="json") for x in letters],
    }
