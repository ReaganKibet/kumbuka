"""Organization settings, programmes and team management (invites, roles, supervisors, caseload transfer)."""

import hashlib
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import ADMIN_ROLES, CLINICAL_ROLES, Client, Invite, Organization, Programme, Therapist
from ..schemas import (
    AcceptInviteIn,
    InviteCreated,
    InviteIn,
    InviteOut,
    MemberOut,
    MemberUpdate,
    OrgOut,
    OrgUpdate,
    ProgrammeIn,
    ProgrammeOut,
    ProgrammeUpdate,
    PublicInviteOut,
    TokenOut,
    TransferIn,
)
from ..security import (
    admins_only,
    audit,
    client_ip,
    create_token,
    current_therapist,
    hash_password,
    public_ip_limiter,
    utcnow_naive,
)
from .auth import therapist_out

router = APIRouter(tags=["organization"])


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ---------- organization ----------
@router.get("/org", response_model=OrgOut)
def get_org(db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    return db.get(Organization, me.organization_id)


@router.patch("/org", response_model=OrgOut)
def update_org(body: OrgUpdate, db: Session = Depends(get_db), me: Therapist = Depends(admins_only)):
    org = db.get(Organization, me.organization_id)
    changes = body.model_dump(exclude_unset=True)
    if org.is_demo and ("name" in changes or "kind" in changes):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The demo organization's name and type are locked.")
    for k, v in changes.items():
        if k == "country" and v:
            v = v.upper()
        setattr(org, k, v)
    audit(db, me, "update", "organization", org.id, ", ".join(sorted(changes))[:255])
    db.commit()
    return org


# ---------- programmes ----------
@router.get("/programmes", response_model=list[ProgrammeOut])
def list_programmes(db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    return db.scalars(
        select(Programme).where(Programme.organization_id == me.organization_id).order_by(Programme.active.desc(), Programme.name)
    ).all()


@router.post("/programmes", response_model=ProgrammeOut, status_code=201)
def create_programme(body: ProgrammeIn, db: Session = Depends(get_db), me: Therapist = Depends(admins_only)):
    p = Programme(organization_id=me.organization_id, **body.model_dump())
    db.add(p)
    db.flush()
    audit(db, me, "create", "programme", p.id, p.name[:255])
    db.commit()
    return p


@router.patch("/programmes/{programme_id}", response_model=ProgrammeOut)
def update_programme(programme_id: int, body: ProgrammeUpdate, db: Session = Depends(get_db), me: Therapist = Depends(admins_only)):
    p = db.get(Programme, programme_id)
    if p is None or p.organization_id != me.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Programme not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    audit(db, me, "update", "programme", p.id)
    db.commit()
    return p


# ---------- team ----------
def _members(db: Session, org_id: int) -> list[MemberOut]:
    counts = dict(
        db.execute(
            select(Client.therapist_id, func.count(Client.id))
            .where(Client.organization_id == org_id, Client.status == "active")
            .group_by(Client.therapist_id)
        ).all()
    )
    out = []
    for t in db.scalars(select(Therapist).where(Therapist.organization_id == org_id).order_by(Therapist.active.desc(), Therapist.name)):
        m = MemberOut.model_validate(t)
        m.caseload = counts.get(t.id, 0)
        out.append(m)
    return out


@router.get("/team", response_model=list[MemberOut])
def list_team(db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    members = _members(db, me.organization_id)
    if me.role not in ADMIN_ROLES:
        # Non-admins only need names and roles (for assigning, facilitating, supervision lines).
        for m in members:
            m.email = ""
            m.totp_enabled = False
    return members


@router.patch("/team/{member_id}", response_model=MemberOut)
def update_member(member_id: int, body: MemberUpdate, db: Session = Depends(get_db), me: Therapist = Depends(admins_only)):
    t = db.get(Therapist, member_id)
    if t is None or t.organization_id != me.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team member not found")
    changes = body.model_dump(exclude_unset=True)

    owners = db.scalar(
        select(func.count(Therapist.id)).where(
            Therapist.organization_id == me.organization_id, Therapist.role == "owner", Therapist.active.is_(True)
        )
    )
    losing_owner = t.role == "owner" and (
        ("role" in changes and changes["role"] != "owner") or changes.get("active") is False
    )
    if losing_owner and owners <= 1:
        raise HTTPException(status.HTTP_409_CONFLICT, "An organization needs at least one active owner.")
    if changes.get("role") == "owner" and me.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an owner can make someone an owner.")
    if t.role == "owner" and me.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an owner can change another owner.")

    if "role" in changes and changes["role"]:
        t.role = changes["role"]
    if changes.get("clear_supervisor"):
        t.supervisor_id = None
    elif changes.get("supervisor_id") is not None:
        sup = db.get(Therapist, changes["supervisor_id"])
        if sup is None or sup.organization_id != me.organization_id or sup.id == t.id \
                or sup.role not in ("owner", "admin", "supervisor"):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Choose a supervisor or admin in your organization.")
        t.supervisor_id = sup.id
    if "active" in changes and changes["active"] is not None:
        t.active = changes["active"]
        if not t.active:
            t.token_version += 1  # signs them out everywhere
    audit(db, me, "update_member", "therapist", t.id, ", ".join(sorted(k for k in changes if k != "clear_supervisor"))[:255])
    db.commit()
    return next(m for m in _members(db, me.organization_id) if m.id == t.id)


@router.post("/team/transfer", status_code=200)
def transfer_caseload(body: TransferIn, db: Session = Depends(get_db), me: Therapist = Depends(admins_only)):
    """Move every active client from one counsellor to another (e.g. when someone leaves)."""
    src, dst = db.get(Therapist, body.from_id), db.get(Therapist, body.to_id)
    for t in (src, dst):
        if t is None or t.organization_id != me.organization_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Team member not found")
    if not dst.active or dst.role not in CLINICAL_ROLES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Transfer clients to an active counsellor.")
    moved = db.execute(
        update(Client)
        .where(Client.organization_id == me.organization_id, Client.therapist_id == src.id, Client.status != "closed")
        .values(therapist_id=dst.id)
    ).rowcount
    audit(db, me, "transfer_caseload", "therapist", src.id, f"{moved} clients to {dst.name}"[:255])
    db.commit()
    return {"moved": moved}


# ---------- invites ----------
def invite_status(i: Invite) -> str:
    if i.accepted_at:
        return "accepted"
    if i.revoked_at:
        return "revoked"
    if i.expires_at <= utcnow_naive():
        return "expired"
    return "pending"


def invite_out(i: Invite) -> InviteOut:
    o = InviteOut.model_validate(i)
    o.status = invite_status(i)
    return o


@router.get("/invites", response_model=list[InviteOut])
def list_invites(db: Session = Depends(get_db), me: Therapist = Depends(admins_only)):
    rows = db.scalars(
        select(Invite).where(Invite.organization_id == me.organization_id).order_by(Invite.created_at.desc()).limit(100)
    ).all()
    return [invite_out(i) for i in rows]


@router.post("/invites", response_model=InviteCreated, status_code=201)
def create_invite(body: InviteIn, db: Session = Depends(get_db), me: Therapist = Depends(admins_only)):
    org = db.get(Organization, me.organization_id)
    if org.is_demo:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invites are switched off in the demo.")
    if body.role == "owner" and me.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an owner can invite another owner.")
    email = body.email.lower()
    if db.scalar(select(Therapist).where(func.lower(Therapist.email) == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Someone with this email already has a Kumbuka account.")
    if body.supervisor_id is not None:
        sup = db.get(Therapist, body.supervisor_id)
        if sup is None or sup.organization_id != me.organization_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown supervisor.")
    token = secrets.token_urlsafe(24)
    inv = Invite(
        organization_id=me.organization_id, email=email, name=(body.name or "").strip() or None, role=body.role,
        supervisor_id=body.supervisor_id, token_hash=_hash(token), expires_at=utcnow_naive() + timedelta(days=body.days),
        created_by_id=me.id,
    )
    db.add(inv)
    db.flush()
    audit(db, me, "invite", "invite", inv.id, f"{email} as {body.role}"[:255])
    db.commit()
    return InviteCreated(**invite_out(inv).model_dump(), token=token)


@router.delete("/invites/{invite_id}", response_model=InviteOut)
def revoke_invite(invite_id: int, db: Session = Depends(get_db), me: Therapist = Depends(admins_only)):
    inv = db.get(Invite, invite_id)
    if inv is None or inv.organization_id != me.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite not found")
    if invite_status(inv) == "pending":
        inv.revoked_at = utcnow_naive()
        audit(db, me, "revoke", "invite", inv.id)
        db.commit()
    return invite_out(inv)


def _open_invite(token: str, request: Request, db: Session) -> Invite:
    ip = client_ip(request)
    if public_ip_limiter.blocked(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Please try again later.")
    inv = db.scalar(select(Invite).where(Invite.token_hash == _hash(token)))
    if inv is None:
        public_ip_limiter.hit(ip)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This invitation link isn't valid.")
    st = invite_status(inv)
    if st != "pending":
        raise HTTPException(status.HTTP_410_GONE, {
            "accepted": "This invitation has already been used. Sign in instead.",
            "revoked": "This invitation was cancelled. Ask your administrator for a new one.",
            "expired": "This invitation has expired. Ask your administrator for a new one.",
        }[st])
    return inv


@router.get("/public/invites/{token}", response_model=PublicInviteOut)
def public_invite(token: str, request: Request, db: Session = Depends(get_db)):
    inv = _open_invite(token, request, db)
    org = db.get(Organization, inv.organization_id)
    return PublicInviteOut(organization_name=org.name, email=inv.email, name=inv.name, role=inv.role)


@router.post("/public/invites/{token}", response_model=TokenOut, status_code=201)
def accept_invite(token: str, body: AcceptInviteIn, request: Request, db: Session = Depends(get_db)):
    inv = _open_invite(token, request, db)
    if db.scalar(select(Therapist).where(func.lower(Therapist.email) == inv.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists. Sign in instead.")
    t = Therapist(
        organization_id=inv.organization_id, role=inv.role, supervisor_id=inv.supervisor_id,
        name=body.name.strip(), email=inv.email, password_hash=hash_password(body.password),
    )
    db.add(t)
    db.flush()
    inv.accepted_at = utcnow_naive()
    audit(db, t, "join", "organization", inv.organization_id, f"as {inv.role}")
    db.commit()
    return TokenOut(token=create_token(t), therapist=therapist_out(t, db))
