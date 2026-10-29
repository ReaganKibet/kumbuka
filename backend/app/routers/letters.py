from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..ai import draft_letter
from ..config import settings
from ..db import get_db
from ..models import CounselingSession, Goal, Letter, Therapist
from ..schemas import AuditEventIn, LetterDraftIn, LetterDraftOut, LetterIn, LetterOut, LetterUpdate
from ..security import audit, current_therapist, owned_client

router = APIRouter(tags=["letters"])

S = CounselingSession


def _d(dt) -> str:
    return f"{dt.day} {dt:%B %Y}"


def _signoff(me: Therapist) -> str:
    lines = ["Yours sincerely,", "", "", me.name]
    if me.title:
        lines.append(me.title)
    if me.license_no:
        lines.append(f"Registration no. {me.license_no}")
    return "\n".join(lines)


@router.post("/clients/{client_id}/letters/draft", response_model=LetterDraftOut)
def draft(client_id: int, body: LetterDraftIn, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    """Returns a starting draft for the counselor to edit. Nothing is saved."""
    client = owned_client(db, client_id, me)
    name = client.full_name
    attended = db.scalars(
        select(S.scheduled_at).where(S.client_id == client.id, S.status == "attended").order_by(S.scheduled_at)
    ).all()
    salutation = f"Dear {body.recipient.splitlines()[0]}," if body.recipient else "To whom it may concern,"

    if body.kind == "attendance":
        if attended:
            first, last = attended[0], attended[-1]
            span = f"on {_d(first)}" if len(attended) == 1 else f"between {_d(first)} and {_d(last)}"
            sessions = f"{len(attended)} counseling session{'s' if len(attended) > 1 else ''} {span}"
        else:
            sessions = "counseling sessions [add dates]"
        subject = f"Confirmation of attendance: {name}"
        text = (
            f"{salutation}\n\n"
            f"This is to confirm that {name} attended {sessions}"
            f"{' at ' + me.practice_name if me.practice_name else ''}.\n\n"
            f"{body.reason.strip() + chr(10) + chr(10) if body.reason else ''}"
            "In line with professional confidentiality, the content of the sessions is not disclosed in this letter. "
            "Please contact me if you need any further information.\n\n"
            f"{_signoff(me)}"
        )
        return LetterDraftOut(subject=subject, body=text)

    if body.kind == "referral":
        subject = f"Referral: {name}"
        ai_text, message = None, None
        if body.use_ai:
            if not settings.ai_enabled:
                message = "AI is off, so this is the standard template."
            elif not client.consent_ai:
                message = "This client hasn't consented to AI-assisted notes, so this is the standard template."
            else:
                notes = db.scalars(
                    select(S).where(S.client_id == client.id, S.note_status == "signed").order_by(S.scheduled_at.desc()).limit(5)
                ).all()
                goals = db.scalars(select(Goal).where(Goal.client_id == client.id, Goal.status == "active")).all()
                context = "\n\n".join(
                    [f"Presenting concern: {client.presenting_concern or 'not recorded'}",
                     f"Reason for referral given by counselor: {body.reason or 'not given'}",
                     f"Number of sessions attended: {len(attended)}",
                     "Active goals: " + ("; ".join(g.description for g in goals) or "none")]
                    + [f"Session {s.scheduled_at:%Y-%m-%d}\nData: {s.data or '-'}\nAssessment: {s.assessment or '-'}\nPlan: {s.plan or '-'}\nRisk check: {s.risk_check or '-'}"
                       for s in reversed(notes)]
                )
                ai_text, message = draft_letter(context)
                audit(db, me, "ai_letter", "client", client.id)
                db.commit()
        if ai_text:
            # The model writes "[Client]"; the real name is only added here, never sent to the AI.
            middle = ai_text.replace("[Client]", name)
        else:
            middle = (
                f"I am writing to refer {name}, whom I have seen for {len(attended) or '[number of]'} counseling "
                f"session{'s' if len(attended) != 1 else ''}"
                f"{' since ' + format(attended[0], '%B %Y') if attended else ''}.\n\n"
                f"Reason for referral: {body.reason or '[reason]'}\n\n"
                f"Presenting concern: {client.presenting_concern or '[presenting concern]'}\n\n"
                "Summary of work so far: [summary]\n\n"
                f"{name} is aware of and has agreed to this referral."
            )
        text = f"{salutation}\n\n{middle}\n\nThank you for seeing them. I am happy to discuss further.\n\n{_signoff(me)}"
        return LetterDraftOut(subject=subject, body=text, ai_used=bool(ai_text), message=message)

    return LetterDraftOut(subject=f"Re: {name}", body=f"{salutation}\n\n\n\n{_signoff(me)}")


@router.get("/clients/{client_id}/letters", response_model=list[LetterOut])
def list_letters(client_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    client = owned_client(db, client_id, me)
    return db.scalars(select(Letter).where(Letter.client_id == client.id).order_by(Letter.created_at.desc())).all()


@router.post("/clients/{client_id}/letters", response_model=LetterOut, status_code=201)
def create_letter(client_id: int, body: LetterIn, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    client = owned_client(db, client_id, me)
    letter = Letter(therapist_id=me.id, client_id=client.id, **body.model_dump())
    db.add(letter)
    db.flush()
    audit(db, me, "create", "letter", letter.id, body.kind)
    db.commit()
    return letter


def _owned_letter(db: Session, letter_id: int, me: Therapist) -> Letter:
    letter = db.get(Letter, letter_id)
    if letter is None or letter.therapist_id != me.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Letter not found")
    return letter


@router.get("/letters/{letter_id}", response_model=LetterOut)
def get_letter(letter_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    letter = _owned_letter(db, letter_id, me)
    audit(db, me, "view", "letter", letter.id)
    db.commit()
    return letter


@router.patch("/letters/{letter_id}", response_model=LetterOut)
def update_letter(letter_id: int, body: LetterUpdate, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    letter = _owned_letter(db, letter_id, me)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(letter, k, v)
    audit(db, me, "update", "letter", letter.id)
    db.commit()
    return letter


@router.delete("/letters/{letter_id}", status_code=204)
def delete_letter(letter_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    letter = _owned_letter(db, letter_id, me)
    audit(db, me, "delete", "letter", letter.id)
    db.delete(letter)
    db.commit()


@router.post("/audit-events", status_code=204)
def record_event(body: AuditEventIn, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    """The frontend reports prints so they appear in the activity log."""
    audit(db, me, body.action, body.entity, body.entity_id)
    db.commit()
