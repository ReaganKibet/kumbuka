from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..ai import draft_note
from ..db import get_db
from ..models import Addendum, CounselingSession, Therapist, utcnow
from ..schemas import AddendumIn, DraftIn, DraftOut, SessionCreate, SessionOut, SessionUpdate
from ..security import audit, current_therapist, owned_client

router = APIRouter(tags=["sessions"])

S = CounselingSession
NOTE_FIELDS = {"mood_rating", "dictation", "data", "assessment", "plan", "interventions", "homework", "risk_check"}


def owned_session(db: Session, session_id: int, me: Therapist) -> CounselingSession:
    s = db.scalar(select(S).options(selectinload(S.addenda)).where(S.id == session_id))
    if s is None or s.therapist_id != me.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return s


@router.get("/clients/{client_id}/sessions", response_model=list[SessionOut])
def list_sessions(client_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    client = owned_client(db, client_id, me)
    return db.scalars(
        select(S).options(selectinload(S.addenda)).where(S.client_id == client.id).order_by(S.scheduled_at.desc())
    ).all()


@router.post("/clients/{client_id}/sessions", response_model=SessionOut, status_code=201)
def create_session(
    client_id: int, body: SessionCreate, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)
):
    client = owned_client(db, client_id, me)
    s = S(therapist_id=me.id, client_id=client.id, scheduled_at=body.scheduled_at.replace(tzinfo=None),
          duration_min=body.duration_min)
    db.add(s)
    db.flush()
    audit(db, me, "create", "session", s.id)
    db.commit()
    return owned_session(db, s.id, me)


@router.get("/sessions/{session_id}", response_model=SessionOut)
def get_session(session_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    s = owned_session(db, session_id, me)
    audit(db, me, "view", "session", s.id)
    db.commit()
    return s


@router.patch("/sessions/{session_id}", response_model=SessionOut)
def update_session(
    session_id: int, body: SessionUpdate, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)
):
    s = owned_session(db, session_id, me)
    changes = body.model_dump(exclude_unset=True)
    if s.note_status == "signed":
        # The private note stays editable; the clinical record does not.
        locked = set(changes) - {"private_note"}
        if locked:
            raise HTTPException(status.HTTP_409_CONFLICT, "This note is signed. Add an addendum instead of editing it.")
    if "scheduled_at" in changes and changes["scheduled_at"] is not None:
        changes["scheduled_at"] = changes["scheduled_at"].replace(tzinfo=None)
    for k, v in changes.items():
        setattr(s, k, v)
    if NOTE_FIELDS & set(changes) and s.status == "scheduled":
        s.status = "attended"
    audit(db, me, "update", "session", s.id, ", ".join(sorted(changes))[:255])
    db.commit()
    return owned_session(db, s.id, me)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    s = owned_session(db, session_id, me)
    if s.note_status == "signed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Signed notes cannot be deleted.")
    audit(db, me, "delete", "session", s.id)
    db.delete(s)
    db.commit()


@router.post("/sessions/{session_id}/sign", response_model=SessionOut)
def sign_session(session_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    s = owned_session(db, session_id, me)
    if s.note_status == "signed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Already signed.")
    if s.status in ("cancelled", "no_show"):
        # Signing a cancellation/no-show record is allowed without note content.
        pass
    elif not (s.data or "").strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Write at least the Data section before signing.")
    else:
        s.status = "attended"
    s.note_status = "signed"
    s.signed_at = utcnow()
    audit(db, me, "sign", "session", s.id)
    db.commit()
    return owned_session(db, s.id, me)


@router.post("/sessions/{session_id}/addenda", response_model=SessionOut, status_code=201)
def add_addendum(
    session_id: int, body: AddendumIn, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)
):
    s = owned_session(db, session_id, me)
    if s.note_status != "signed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Draft notes can be edited directly; addenda are for signed notes.")
    db.add(Addendum(session_id=s.id, therapist_id=me.id, text=body.text.strip()))
    audit(db, me, "addendum", "session", s.id)
    db.commit()
    db.expire(s)
    return owned_session(db, s.id, me)


@router.post("/sessions/{session_id}/ai-draft", response_model=DraftOut)
def ai_draft(
    session_id: int, body: DraftIn, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)
):
    """Returns a draft only. Nothing is saved until the counselor reviews it and saves the note."""
    s = owned_session(db, session_id, me)
    if s.note_status == "signed":
        raise HTTPException(status.HTTP_409_CONFLICT, "This note is already signed.")
    if not s.client.consent_ai:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This client has not consented to AI-assisted notes. Record their consent on the Profile tab first.",
        )
    result = draft_note(body.dictation)
    audit(db, me, "ai_draft", "session", s.id, "ai" if result["ai_used"] else "fallback")
    db.commit()
    return result
