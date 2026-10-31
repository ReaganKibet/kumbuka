import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..ai import can_transcribe
from ..config import settings
from ..db import get_db
from ..models import Organization, Therapist
from ..schemas import (
    AuthConfigOut,
    DemoLoginIn,
    OrgOut,
    LoginIn,
    LoginOut,
    MfaIn,
    PasswordChange,
    ProfileUpdate,
    RecoveryCodesOut,
    RegisterIn,
    TherapistOut,
    TokenOut,
    TotpCode,
    TotpDisable,
    TotpSetupOut,
)
from ..security import (
    _DUMMY_HASH,
    audit,
    check_not_locked,
    check_totp,
    client_ip,
    create_mfa_token,
    create_token,
    current_therapist,
    decode_token,
    encrypt,
    hash_password,
    login_ip_limiter,
    new_recovery_codes,
    record_failure,
    record_success,
    totp_uri,
    use_recovery_code,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def therapist_out(t: Therapist, db: Session | None = None) -> TherapistOut:
    out = TherapistOut.model_validate(t)
    out.recovery_codes_left = len(t.recovery_codes or []) if t.totp_enabled else 0
    if db is not None and t.organization_id:
        org = db.get(Organization, t.organization_id)
        out.organization = OrgOut.model_validate(org)
        out.ai_available = settings.ai_allowed_for(org)
        out.can_transcribe = out.ai_available and can_transcribe()
    return out


def not_in_demo(db: Session, me: Therapist):
    org = db.get(Organization, me.organization_id) if me.organization_id else None
    if org is not None and org.is_demo:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This is a shared demo account, so this setting is locked.")


def registration_open(db: Session) -> bool:
    if settings.registration == "true":
        return True
    if settings.registration == "first":
        real = select(func.count(Therapist.id)).join(Organization, Organization.id == Therapist.organization_id) \
            .where(Organization.is_demo.is_(False))
        return (db.scalar(real) or 0) == 0
    return False


def _ip_guard(request: Request):
    if login_ip_limiter.blocked(client_ip(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many sign-in attempts from this network. Try again in 15 minutes.")


@router.get("/config", response_model=AuthConfigOut)
def auth_config(db: Session = Depends(get_db)):
    return AuthConfigOut(
        registration_open=registration_open(db),
        idle_lock_minutes=settings.idle_lock_minutes,
        ai_enabled=settings.ai_enabled,
        demo_enabled=settings.demo_enabled,
        ai_provider=settings.ai_provider,
        ai_real_data=settings.ai_real_data,
    )


@router.post("/register", response_model=TokenOut, status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    if not registration_open(db):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "New accounts can't be created here. Ask the practice owner.")
    email = body.email.lower()
    if db.scalar(select(Therapist).where(func.lower(Therapist.email) == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    org = Organization(
        name=(body.organization_name or f"{body.name.strip()}'s practice").strip(),
        kind=body.organization_kind,
        country=body.country.upper(),
    )
    db.add(org)
    db.flush()
    therapist = Therapist(organization_id=org.id, role="owner", name=body.name.strip(), email=email,
                          password_hash=hash_password(body.password))
    db.add(therapist)
    db.flush()
    audit(db, therapist, "register", "organization", org.id, org.name[:255])
    db.commit()
    return TokenOut(token=create_token(therapist), therapist=therapist_out(therapist, db))


@router.post("/login", response_model=LoginOut)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    _ip_guard(request)
    therapist = db.scalar(select(Therapist).where(func.lower(Therapist.email) == body.email.lower()))
    if therapist is None:
        verify_password(body.password, _DUMMY_HASH)  # same timing as a real check
        login_ip_limiter.hit(client_ip(request))
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    check_not_locked(therapist)
    if not verify_password(body.password, therapist.password_hash):
        login_ip_limiter.hit(client_ip(request))
        record_failure(db, therapist)
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password")
    if not therapist.active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated. Contact your organization's administrator.")

    if therapist.totp_enabled:
        db.commit()
        return LoginOut(mfa_required=True, mfa_token=create_mfa_token(therapist))

    record_success(therapist)
    audit(db, therapist, "login", "therapist", therapist.id)
    db.commit()
    return LoginOut(token=create_token(therapist), therapist=therapist_out(therapist, db))


@router.post("/login/mfa", response_model=TokenOut)
def login_mfa(body: MfaIn, request: Request, db: Session = Depends(get_db)):
    _ip_guard(request)
    therapist = decode_token(body.mfa_token, "mfa", db)
    if therapist is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This sign-in has expired. Enter your password again.")
    check_not_locked(therapist)
    used_recovery = False
    if not check_totp(therapist, body.code):
        used_recovery = use_recovery_code(therapist, body.code)
        if not used_recovery:
            login_ip_limiter.hit(client_ip(request))
            record_failure(db, therapist)
            db.commit()
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That code didn't work. Check the time on your phone and try again.")
    record_success(therapist)
    audit(db, therapist, "login", "therapist", therapist.id, "recovery code" if used_recovery else "2-step")
    db.commit()
    return TokenOut(token=create_token(therapist), therapist=therapist_out(therapist, db))


@router.post("/demo", response_model=TokenOut)
def demo_login(body: DemoLoginIn, request: Request, db: Session = Depends(get_db)):
    """One click into the fictional demo organization, as the chosen role. No password needed."""
    if not settings.demo_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The demo isn't available here.")
    ip = client_ip(request)
    if login_ip_limiter.blocked(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Try again in a few minutes.")
    login_ip_limiter.hit(ip)
    from ..demo import demo_user  # local import keeps demo code out of normal requests

    t = demo_user(db, body.role)
    if t is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The demo is being rebuilt. Try again in a moment.")
    audit(db, t, "login", "therapist", t.id, "demo")
    db.commit()
    return TokenOut(token=create_token(t), therapist=therapist_out(t, db))


@router.get("/me", response_model=TherapistOut)
def me(therapist: Therapist = Depends(current_therapist), db: Session = Depends(get_db)):
    return therapist_out(therapist, db)


@router.patch("/me", response_model=TherapistOut)
def update_me(body: ProfileUpdate, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    not_in_demo(db, me)
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(me, k, v.strip() if isinstance(v, str) else v)
    audit(db, me, "update", "therapist", me.id, ", ".join(sorted(changes))[:255])
    db.commit()
    return therapist_out(me, db)


@router.post("/me/password", response_model=TokenOut)
def change_password(body: PasswordChange, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    not_in_demo(db, me)
    if not verify_password(body.current_password, me.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Your current password is not correct.")
    me.password_hash = hash_password(body.new_password)
    me.token_version += 1  # signs out every other device
    audit(db, me, "password_changed", "therapist", me.id)
    db.commit()
    return TokenOut(token=create_token(me), therapist=therapist_out(me, db))


@router.post("/me/logout-all", status_code=204)
def logout_everywhere(db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    not_in_demo(db, me)
    me.token_version += 1
    audit(db, me, "logout_all", "therapist", me.id)
    db.commit()


@router.post("/me/2fa/setup", response_model=TotpSetupOut)
def totp_setup(db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    not_in_demo(db, me)
    if me.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-step sign-in is already on.")
    secret = pyotp.random_base32()
    me.totp_secret_enc = encrypt(secret)
    me.totp_last_counter = None
    db.commit()
    return TotpSetupOut(secret=secret, otpauth_uri=totp_uri(secret, me.email))


@router.post("/me/2fa/enable", response_model=RecoveryCodesOut)
def totp_enable(body: TotpCode, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    if me.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Two-step sign-in is already on.")
    if not me.totp_secret_enc or not check_totp(me, body.code):
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code didn't match. Enter the current 6-digit code from your app.")
    codes, hashes = new_recovery_codes()
    me.totp_enabled = True
    me.recovery_codes = hashes
    audit(db, me, "2fa_enabled", "therapist", me.id)
    db.commit()
    return RecoveryCodesOut(recovery_codes=codes)


@router.post("/me/2fa/recovery-codes", response_model=RecoveryCodesOut)
def totp_new_codes(body: TotpCode, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    if not me.totp_enabled or not check_totp(me, body.code):
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code didn't match.")
    codes, hashes = new_recovery_codes()
    me.recovery_codes = hashes
    audit(db, me, "2fa_codes_renewed", "therapist", me.id)
    db.commit()
    return RecoveryCodesOut(recovery_codes=codes)


@router.post("/me/2fa/disable", response_model=TherapistOut)
def totp_disable(body: TotpDisable, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    if not me.totp_enabled:
        return therapist_out(me, db)
    if not verify_password(body.password, me.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Your password is not correct.")
    if not (check_totp(me, body.code) or use_recovery_code(me, body.code)):
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That code didn't match.")
    me.totp_enabled = False
    me.totp_secret_enc = None
    me.recovery_codes = None
    me.totp_last_counter = None
    audit(db, me, "2fa_disabled", "therapist", me.id)
    db.commit()
    return therapist_out(me, db)
