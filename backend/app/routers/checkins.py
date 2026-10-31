"""Client check-in links.

The counselor creates a one-time link and sends it to the client (WhatsApp or SMS). The client
opens it on their phone, answers the questionnaires, and the scores appear in the client's record.
Only a hash of the link's token is stored, so a database leak does not expose working links.
"""

import hashlib
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import local_now
from ..db import get_db
from ..measures import MEASURES, MeasureError, public_definitions, score
from ..models import Assessment, CheckinLink, Client, Organization, Therapist
from ..schemas import CheckinCreate, CheckinCreated, CheckinOut, PublicCheckinIn, PublicCheckinOut, PublicCheckinResult
from ..security import audit, client_ip, clinical_only, current_therapist, owned_client, public_ip_limiter, utcnow_naive

router = APIRouter(tags=["check-ins"])

# Questions are shown to the client in their own voice.
CLIENT_PROMPTS = {
    "PHQ-9": "Over the last 2 weeks, how often have you been bothered by any of the following problems?",
    "GAD-7": "Over the last 2 weeks, how often have you been bothered by the following problems?",
    "WHO-5": "Over the last two weeks, how much of the time have you felt the following?",
}

# Shown to clients when an organization hasn't set its own crisis contacts.
# Only countries whose numbers have been verified are listed (last checked October 2026).
DEFAULT_SUPPORT = {
    "KE": [
        {"name": "Emergency services", "number": "999", "note": "If you are in danger right now (or 112)"},
        {"name": "Kenya Red Cross", "number": "1199", "note": "Free call"},
        {"name": "Befrienders Kenya", "number": "+254 722 178 177", "note": "Emotional support, 9am to 5pm"},
    ],
}


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def status_of(link: CheckinLink) -> str:
    if link.completed_at:
        return "completed"
    if link.revoked_at:
        return "revoked"
    if link.expires_at <= utcnow_naive():
        return "expired"
    return "pending"


def to_out(link: CheckinLink) -> CheckinOut:
    out = CheckinOut.model_validate(link)
    out.status = status_of(link)
    return out


# ---------- counselor side ----------
@router.post("/clients/{client_id}/checkins", response_model=CheckinCreated, status_code=201)
def create_checkin(client_id: int, body: CheckinCreate, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)):
    client = owned_client(db, client_id, me)
    kinds = list(dict.fromkeys(body.kinds))
    unknown = [k for k in kinds if k not in MEASURES]
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown questionnaire: {', '.join(unknown)}")
    token = secrets.token_urlsafe(24)
    link = CheckinLink(
        therapist_id=me.id, client_id=client.id, token_hash=_hash(token), kinds=kinds,
        expires_at=utcnow_naive() + timedelta(days=body.days),
    )
    db.add(link)
    db.flush()
    audit(db, me, "create", "checkin", link.id, ", ".join(kinds))
    db.commit()
    return CheckinCreated(**to_out(link).model_dump(), token=token)


@router.get("/clients/{client_id}/checkins", response_model=list[CheckinOut])
def list_checkins(client_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    client = owned_client(db, client_id, me)
    links = db.scalars(
        select(CheckinLink).where(CheckinLink.client_id == client.id).order_by(CheckinLink.created_at.desc()).limit(50)
    ).all()
    return [to_out(link) for link in links]


@router.delete("/checkins/{checkin_id}", response_model=CheckinOut)
def revoke_checkin(checkin_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    link = db.get(CheckinLink, checkin_id)
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Check-in not found")
    owned_client(db, link.client_id, me)
    if status_of(link) == "pending":
        link.revoked_at = utcnow_naive()
        audit(db, me, "revoke", "checkin", link.id)
        db.commit()
    return to_out(link)


# ---------- client side (no sign-in; the link is the key) ----------
def _open_link(token: str, request: Request, db: Session) -> CheckinLink:
    ip = client_ip(request)
    if public_ip_limiter.blocked(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Please try again later.")
    link = db.scalar(select(CheckinLink).where(CheckinLink.token_hash == _hash(token)))
    if link is None:
        public_ip_limiter.hit(ip)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This link isn't valid. Please ask your counselor for a new one.")
    st = status_of(link)
    if st == "completed":
        raise HTTPException(status.HTTP_410_GONE, "You've already sent your answers. Thank you.")
    if st != "pending":
        raise HTTPException(status.HTTP_410_GONE, "This link has expired. Please ask your counselor for a new one.")
    return link


@router.get("/public/checkins/{token}", response_model=PublicCheckinOut)
def public_get(token: str, request: Request, db: Session = Depends(get_db)):
    link = _open_link(token, request, db)
    client = db.get(Client, link.client_id)
    counselor = db.get(Therapist, link.therapist_id)
    defs = {d["kind"]: d for d in public_definitions()}
    measures = [defs[k] | {"prompt": CLIENT_PROMPTS.get(k, defs[k]["prompt"])} for k in link.kinds]
    org = db.get(Organization, client.organization_id) if client.organization_id else None
    country = org.country if org else "KE"
    contacts = (org.crisis_contacts if org and org.crisis_contacts else None) or DEFAULT_SUPPORT.get(country, [])
    return PublicCheckinOut(
        first_name=(client.preferred_name or client.full_name).split()[0],
        counselor_name=counselor.name,
        practice_name=(org.name if org and org.kind != "private_practice" else None) or counselor.practice_name,
        measures=measures,
        expires_at=link.expires_at,
        country=country,
        support_contacts=contacts,
    )


@router.post("/public/checkins/{token}", response_model=PublicCheckinResult)
def public_submit(token: str, body: PublicCheckinIn, request: Request, db: Session = Depends(get_db)):
    link = _open_link(token, request, db)
    missing = [k for k in link.kinds if k not in body.answers]
    if missing:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Please answer every question before sending.")

    show_support = False
    now = local_now()
    scored = []
    for kind in link.kinds:
        try:
            result = score(kind, body.answers[kind])
        except MeasureError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Please answer every question before sending.")
        if kind == "PHQ-9" and body.answers[kind][8] > 0:
            show_support = True
        scored.append((kind, result))

    for kind, result in scored:
        db.add(Assessment(
            therapist_id=link.therapist_id, client_id=link.client_id, kind=kind, answers=body.answers[kind],
            total=result["total"], severity=result["severity"], flags=result["flags"], source="client", taken_at=now,
        ))
    link.completed_at = utcnow_naive()
    link.mood = body.mood
    link.message = (body.message or "").strip() or None
    counselor = db.get(Therapist, link.therapist_id)
    audit(db, counselor, "checkin_completed", "client", link.client_id, ", ".join(link.kinds))
    db.commit()
    return PublicCheckinResult(ok=True, show_support=show_support)
