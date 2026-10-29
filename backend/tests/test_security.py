from datetime import datetime, timedelta, timezone

import pyotp

from app.config import settings
from helpers import PASSWORD, signup


def _secret_for(api, headers):
    r = api.post("/api/auth/me/2fa/setup", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["secret"]


def test_security_headers(api):
    r = api.get("/api/health")
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert r.headers["cache-control"] == "no-store"


def test_registration_first_account_only(api, monkeypatch):
    signup(api, "owner@test.ke")  # at least one account exists now
    monkeypatch.setattr(settings, "registration", "first")
    assert api.get("/api/auth/config").json()["registration_open"] is False
    r = api.post("/api/auth/register", json={"name": "X", "email": "intruder@test.ke", "password": PASSWORD})
    assert r.status_code == 403


def test_short_password_rejected(api):
    r = api.post("/api/auth/register", json={"name": "X", "email": "short@test.ke", "password": "short123"})
    assert r.status_code == 422


def test_lockout_after_five_failures(api):
    signup(api, "lock@test.ke")
    for _ in range(5):
        assert api.post("/api/auth/login", json={"email": "lock@test.ke", "password": "wrong-password"}).status_code == 401
    r = api.post("/api/auth/login", json={"email": "lock@test.ke", "password": PASSWORD})
    assert r.status_code == 429 and "locked" in r.json()["detail"]


def test_ip_rate_limit(api):
    for i in range(20):
        api.post("/api/auth/login", json={"email": f"nobody{i}@test.ke", "password": "whatever-123"})
    assert api.post("/api/auth/login", json={"email": "nobody@test.ke", "password": "whatever-123"}).status_code == 429


def test_logout_everywhere_and_password_change_revoke_tokens(api):
    h = signup(api, "revoke@test.ke")
    assert api.get("/api/auth/me", headers=h).status_code == 200
    assert api.post("/api/auth/me/logout-all", headers=h).status_code == 204
    assert api.get("/api/auth/me", headers=h).status_code == 401

    tok = api.post("/api/auth/login", json={"email": "revoke@test.ke", "password": PASSWORD}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert api.post("/api/auth/me/password", json={"current_password": "nope-nope-nope", "new_password": "another-pass-1"}, headers=h).status_code == 400
    r = api.post("/api/auth/me/password", json={"current_password": PASSWORD, "new_password": "another-pass-1"}, headers=h)
    assert r.status_code == 200
    assert api.get("/api/auth/me", headers=h).status_code == 401  # old token dead
    assert api.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).status_code == 200


def test_two_step_sign_in(api):
    h = signup(api, "mfa@test.ke")
    secret = _secret_for(api, h)
    totp = pyotp.TOTP(secret)
    assert api.post("/api/auth/me/2fa/enable", json={"code": "000000"}, headers=h).status_code == 400
    r = api.post("/api/auth/me/2fa/enable", json={"code": totp.now()}, headers=h)
    assert r.status_code == 200
    codes = r.json()["recovery_codes"]
    assert len(codes) == 8
    assert api.get("/api/auth/me", headers=h).json()["totp_enabled"] is True

    # Password alone is no longer enough.
    r = api.post("/api/auth/login", json={"email": "mfa@test.ke", "password": PASSWORD})
    body = r.json()
    assert body["mfa_required"] is True and body["token"] is None
    mfa = body["mfa_token"]

    # An access token can't be minted from the mfa token, and the mfa token isn't an access token.
    assert api.get("/api/auth/me", headers={"Authorization": f"Bearer {mfa}"}).status_code == 401

    # The code used to enable can't be replayed.
    assert api.post("/api/auth/login/mfa", json={"mfa_token": mfa, "code": totp.now()}).status_code == 401
    # The next code works.
    nxt = totp.at(datetime.now(timezone.utc) + timedelta(seconds=30))
    r = api.post("/api/auth/login/mfa", json={"mfa_token": mfa, "code": nxt})
    assert r.status_code == 200 and r.json()["token"]

    # Recovery codes work once.
    assert api.post("/api/auth/login/mfa", json={"mfa_token": mfa, "code": codes[0]}).status_code == 200
    assert api.post("/api/auth/login/mfa", json={"mfa_token": mfa, "code": codes[0]}).status_code == 401
    me = api.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).json()
    assert me["recovery_codes_left"] == 7

    # Turning it off needs password + a code.
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert api.post("/api/auth/me/2fa/disable", json={"password": "wrong-password", "code": codes[1]}, headers=h).status_code == 400
    r = api.post("/api/auth/me/2fa/disable", json={"password": PASSWORD, "code": codes[1]}, headers=h)
    assert r.status_code == 200 and r.json()["totp_enabled"] is False


def test_profile_letterhead(api):
    h = signup(api, "profile@test.ke")
    r = api.patch("/api/auth/me", json={"title": "Counselling Psychologist", "practice_name": "Tulia Counselling",
                                        "license_no": "CPB/123"}, headers=h)
    assert r.status_code == 200 and r.json()["practice_name"] == "Tulia Counselling"
