from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..ai import draft_note
from ..db import get_db
from ..models import Addendum, Client, CounselingSession, Organization, Therapist, utcnow
from ..schemas import AddendumIn, DraftIn, DraftOut, ReviewIn, SessionCreate, SessionOut, SessionUpdate
from ..security import audit, can_supervise, client_scope, clinical_only, current_therapist, is_admin, owned_client

router = APIRouter(tags=["sessions"])

S = CounselingSession
NOTE_FIELDS = {"mood_rating", "dictation", "data", "assessment", "plan", "interventions", "homework", "risk_check"}


def owned_session(db: Session, session_id: int, me: Therapist) -> CounselingSession:
    """A session is visible to anyone who can open its client."""
    s = db.scalar(
        select(S).options(selectinload(S.addenda)).join(Client, Client.id == S.client_id)
        .where(S.id == session_id, client_scope(db, me))
    )
    if s is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return s


def authored(s: CounselingSession, me: Therapist):
    if s.therapist_id != me.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the counsellor who wrote this note can change it.")


def needs_review(db: Session, author: Therapist) -> bool:
    if is_admin(author):
        return False
    if author.role == "lay_counsellor":
        return True
    org = db.get(Organization, author.organization_id)
    return bool(org and org.review_all_notes)


def session_out(db: Session, s: CounselingSession, me: Therapist) -> SessionOut:
    out = SessionOut.model_validate(s)
    author = db.get(Therapist, s.therapist_id)
    out.author_id = s.therapist_id
    out.author_name = author.name if author else None
    if s.reviewed_by_id:
        reviewer = db.get(Therapist, s.reviewed_by_id)
        out.reviewer_name = reviewer.name if reviewer else None
    out.can_edit = s.therapist_id == me.id and s.note_status == "draft"
    out.can_review = s.note_status == "submitted" and can_supervise(db, me, s.therapist_id)
    if s.therapist_id != me.id:
        # Private reflections and raw dictation belong to the author alone.
        out.private_note = None
        out.dictation = None
    return out


@router.get("/clients/{client_id}/sessions", response_model=list[SessionOut])
def list_sessions(client_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    client = owned_client(db, client_id, me)
    rows = db.scalars(
        select(S).options(selectinload(S.addenda)).where(S.client_id == client.id).order_by(S.scheduled_at.desc())
    ).all()
    return [session_out(db, s, me) for s in rows]


@router.post("/clients/{client_id}/sessions", response_model=SessionOut, status_code=201)
def create_session(
    client_id: int, body: SessionCreate, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)
):
    client = owned_client(db, client_id, me)
    s = S(therapist_id=me.id, client_id=client.id, scheduled_at=body.scheduled_at.replace(tzinfo=None),
          duration_min=body.duration_min)
    db.add(s)
    db.flush()
    audit(db, me, "create", "session", s.id)
    db.commit()
    return session_out(db, owned_session(db, s.id, me), me)


@router.get("/sessions/{session_id}", response_model=SessionOut)
def get_session(session_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    s = owned_session(db, session_id, me)
    audit(db, me, "view", "session", s.id)
    db.commit()
    return session_out(db, s, me)


@router.patch("/sessions/{session_id}", response_model=SessionOut)
def update_session(
    session_id: int, body: SessionUpdate, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)
):
    s = owned_session(db, session_id, me)
    authored(s, me)
    changes = body.model_dump(exclude_unset=True)
    if s.note_status != "draft":
        # The private note stays editable; the clinical record does not.
        locked = set(changes) - {"private_note"}
        if locked:
            msg = ("This note is waiting for supervisor review." if s.note_status == "submitted"
                   else "This note is signed. Add an addendum instead of editing it.")
            raise HTTPException(status.HTTP_409_CONFLICT, msg)
    if "scheduled_at" in changes and changes["scheduled_at"] is not None:
        changes["scheduled_at"] = changes["scheduled_at"].replace(tzinfo=None)
    for k, v in changes.items():
        setattr(s, k, v)
    if NOTE_FIELDS & set(changes) and s.status == "scheduled":
        s.status = "attended"
    audit(db, me, "update", "session", s.id, ", ".join(sorted(changes))[:255])
    db.commit()
    return session_out(db, owned_session(db, s.id, me), me)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    s = owned_session(db, session_id, me)
    authored(s, me)
    if s.note_status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "Signed or submitted notes cannot be deleted.")
    audit(db, me, "delete", "session", s.id)
    db.delete(s)
    db.commit()


@router.post("/sessions/{session_id}/sign", response_model=SessionOut)
def sign_session(session_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    s = owned_session(db, session_id, me)
    authored(s, me)
    if s.note_status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "Already signed or submitted.")
    if s.status not in ("cancelled", "no_show"):
        if not (s.data or "").strip():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Write at least the Data section before signing.")
        s.status = "attended"
    s.signed_at = utcnow()
    if s.status == "attended" and needs_review(db, me):
        s.note_status = "submitted"
        s.review_status = "pending"
        audit(db, me, "submit_for_review", "session", s.id)
    else:
        s.note_status = "signed"
        audit(db, me, "sign", "session", s.id)
    db.commit()
    return session_out(db, owned_session(db, s.id, me), me)


@router.post("/sessions/{session_id}/review", response_model=SessionOut)
def review_session(
    session_id: int, body: ReviewIn, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)
):
    """Supervisor co-signs a submitted note, or returns it to the counsellor with feedback."""
    s = owned_session(db, session_id, me)
    if s.note_status != "submitted":
        raise HTTPException(status.HTTP_409_CONFLICT, "This note isn't waiting for review.")
    if not can_supervise(db, me, s.therapist_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only this counsellor's supervisor or an admin can review it.")
    s.reviewed_by_id = me.id
    s.reviewed_at = utcnow()
    s.review_comment = (body.comment or "").strip() or None
    if body.decision == "approve":
        s.note_status = "signed"
        s.review_status = "approved"
    else:
        if not s.review_comment:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Say what needs changing when returning a note.")
        s.note_status = "draft"
        s.review_status = "returned"
        s.signed_at = None
    audit(db, me, "review_" + body.decision, "session", s.id)
    db.commit()
    return session_out(db, owned_session(db, s.id, me), me)


@router.post("/sessions/{session_id}/addenda", response_model=SessionOut, status_code=201)
def add_addendum(
    session_id: int, body: AddendumIn, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)
):
    s = owned_session(db, session_id, me)
    if s.note_status != "signed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Addenda are for signed notes.")
    if s.therapist_id != me.id and not can_supervise(db, me, s.therapist_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the author or their supervisor can add an addendum.")
    db.add(Addendum(session_id=s.id, therapist_id=me.id, text=body.text.strip()))
    audit(db, me, "addendum", "session", s.id)
    db.commit()
    db.expire(s)
    return session_out(db, owned_session(db, s.id, me), me)


@router.post("/sessions/{session_id}/ai-draft", response_model=DraftOut)
def ai_draft(
    session_id: int, body: DraftIn, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)
):
    """Returns a draft only. Nothing is saved until the counsellor reviews it and saves the note."""
    s = owned_session(db, session_id, me)
    authored(s, me)
    if s.note_status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "This note is already signed or submitted.")
    if not s.client.consent_ai:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "This client has not consented to AI-assisted notes. Record their consent on the Profile tab first.",
        )
    result = draft_note(body.dictation)
    audit(db, me, "ai_draft", "session", s.id, "ai" if result["ai_used"] else "fallback")
    db.commit()
    return result
