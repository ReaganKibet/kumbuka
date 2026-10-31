import base64
import hashlib
import hmac
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import jwt
import pyotp
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import false, not_, or_, select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import ADMIN_ROLES, CLINICAL_ROLES, AuditLog, Client, Organization, Therapist

_ITERATIONS = 390_000
_bearer = HTTPBearer(auto_error=False)

MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15


# ---------- passwords ----------
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt_b64, digest_b64 = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt_b64), int(iterations))
        return hmac.compare_digest(digest, base64.b64decode(digest_b64))
    except Exception:
        return False


# Used to keep login timing the same whether or not the email exists.
_DUMMY_HASH = hash_password(secrets.token_hex(8))


# ---------- tokens ----------
def _encode(payload: dict, minutes: int) -> str:
    payload = payload | {"exp": datetime.now(timezone.utc) + timedelta(minutes=minutes)}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def create_token(therapist: Therapist) -> str:
    """Access token. Carries token_version so 'sign out everywhere' and password changes revoke it."""
    return _encode({"sub": str(therapist.id), "tv": therapist.token_version, "typ": "access"}, settings.token_hours * 60)


def create_mfa_token(therapist: Therapist) -> str:
    """Short-lived proof that the password step passed; exchanged for an access token with a 2FA code."""
    return _encode({"sub": str(therapist.id), "tv": therapist.token_version, "typ": "mfa"}, 5)


def decode_token(token: str, typ: str, db: Session) -> Therapist | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        if payload.get("typ") != typ:
            return None
        therapist = db.get(Therapist, int(payload["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
    if therapist is None or payload.get("tv") != therapist.token_version or not therapist.active:
        return None
    return therapist


def current_therapist(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> Therapist:
    therapist = decode_token(creds.credentials, "access", db) if creds else None
    if therapist is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in", {"WWW-Authenticate": "Bearer"})
    return therapist


# ---------- two-step sign-in (TOTP) ----------
_fernet = Fernet(settings.fernet_key)


def encrypt(text: str) -> str:
    return _fernet.encrypt(text.encode()).decode()


def decrypt(token: str) -> str | None:
    try:
        return _fernet.decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def totp_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="Kumbuka")


def check_totp(therapist: Therapist, code: str) -> bool:
    """Accepts the current code or one step either side; each code works only once."""
    secret = decrypt(therapist.totp_secret_enc or "")
    code = "".join(ch for ch in code if ch.isdigit())
    if not secret or len(code) != 6:
        return False
    totp = pyotp.TOTP(secret)
    now = datetime.now(timezone.utc)
    for drift in (-1, 0, 1):
        moment = now + timedelta(seconds=30 * drift)
        if hmac.compare_digest(totp.at(moment), code):
            counter = totp.timecode(moment)
            if therapist.totp_last_counter is not None and counter <= therapist.totp_last_counter:
                return False  # replay
            therapist.totp_last_counter = counter
            return True
    return False


def _code_hash(code: str) -> str:
    return hashlib.sha256(code.replace("-", "").strip().lower().encode()).hexdigest()


def new_recovery_codes(n: int = 8) -> tuple[list[str], list[str]]:
    codes = [f"{secrets.token_hex(3)}-{secrets.token_hex(3)}" for _ in range(n)]
    return codes, [_code_hash(c) for c in codes]


def use_recovery_code(therapist: Therapist, code: str) -> bool:
    h = _code_hash(code)
    remaining = list(therapist.recovery_codes or [])
    for stored in remaining:
        if hmac.compare_digest(stored, h):
            remaining.remove(stored)
            therapist.recovery_codes = remaining
            return True
    return False


# ---------- brute-force protection ----------
class RateLimiter:
    """Small in-memory sliding-window limiter, keyed by e.g. IP address. Fine for one server process."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit, self.window = limit, window_seconds
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def _trim(self, q: deque, now: float):
        while q and q[0] <= now - self.window:
            q.popleft()

    def blocked(self, key: str) -> bool:
        with self._lock:
            q = self._hits[key]
            self._trim(q, time.monotonic())
            return len(q) >= self.limit

    def hit(self, key: str):
        with self._lock:
            now = time.monotonic()
            q = self._hits[key]
            self._trim(q, now)
            q.append(now)

    def reset(self):
        with self._lock:
            self._hits.clear()


login_ip_limiter = RateLimiter(limit=20, window_seconds=15 * 60)
public_ip_limiter = RateLimiter(limit=30, window_seconds=10 * 60)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def check_not_locked(therapist: Therapist):
    if therapist.locked_until and therapist.locked_until > utcnow_naive():
        minutes = max(1, int((therapist.locked_until - utcnow_naive()).total_seconds() // 60) + 1)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many failed attempts. This account is locked for {minutes} more minute{'s' if minutes > 1 else ''}.",
        )


def record_failure(db: Session, therapist: Therapist):
    therapist.failed_logins = (therapist.failed_logins or 0) + 1
    if therapist.failed_logins >= MAX_FAILED_LOGINS:
        therapist.locked_until = utcnow_naive() + timedelta(minutes=LOCKOUT_MINUTES)
        therapist.failed_logins = 0
        audit(db, therapist, "locked", "therapist", therapist.id, f"{MAX_FAILED_LOGINS} failed attempts")
    else:
        audit(db, therapist, "login_failed", "therapist", therapist.id)


def record_success(therapist: Therapist):
    therapist.failed_logins = 0
    therapist.locked_until = None


# ---------- roles, scope and audit ----------
def is_admin(u: Therapist) -> bool:
    return u.role in ADMIN_ROLES


def require_roles(*roles: str):
    """Dependency: only these roles may call the endpoint."""

    def dep(me: Therapist = Depends(current_therapist)) -> Therapist:
        if me.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role doesn't allow this.")
        return me

    return dep


clinical_only = require_roles(*CLINICAL_ROLES)
admins_only = require_roles(*ADMIN_ROLES)
reports_access = require_roles("owner", "admin", "supervisor", "me_officer")


def team_ids(db: Session, me: Therapist) -> list[int]:
    """Me plus everyone I supervise (directly)."""
    ids = db.scalars(
        select(Therapist.id).where(Therapist.organization_id == me.organization_id, Therapist.supervisor_id == me.id)
    ).all()
    return [me.id, *ids]


def client_scope(db: Session, me: Therapist):
    """SQL condition for the clients this person may open.

    - Admins: everyone in the organization except restricted cases they aren't involved in.
    - Supervisors: their own clients and their supervisees' clients.
    - Counsellors and lay counsellors: their own clients.
    - M&E officers: no individual records (they see de-identified reports only).
    """
    in_org = Client.organization_id == me.organization_id
    if me.role in ADMIN_ROLES:
        return in_org & or_(not_(Client.restricted), Client.therapist_id.in_(team_ids(db, me)))
    if me.role == "supervisor":
        return in_org & Client.therapist_id.in_(team_ids(db, me))
    if me.role in ("counsellor", "lay_counsellor"):
        return in_org & (Client.therapist_id == me.id)
    return false()


def owned_client(db: Session, client_id: int, me: Therapist) -> Client:
    """Every client lookup goes through here so nobody reaches records outside their scope."""
    client = db.scalar(select(Client).where(Client.id == client_id, client_scope(db, me)))
    if client is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Client not found")
    return client


def can_supervise(db: Session, me: Therapist, author_id: int) -> bool:
    if author_id == me.id:
        return False
    author = db.get(Therapist, author_id)
    if author is None or author.organization_id != me.organization_id:
        return False
    return is_admin(me) or author.supervisor_id == me.id


def org_of(db: Session, me: Therapist) -> Organization:
    return db.get(Organization, me.organization_id)


def audit(db: Session, therapist: Therapist, action: str, entity: str, entity_id: int | None = None, detail: str | None = None):
    db.add(AuditLog(organization_id=therapist.organization_id, therapist_id=therapist.id, action=action,
                    entity=entity, entity_id=entity_id, detail=detail))
