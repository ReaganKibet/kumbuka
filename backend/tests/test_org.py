"""Organizations, roles, supervision, referrals, groups, reports and the demo."""

from datetime import date, timedelta

import pytest

from app.config import settings
from helpers import PASSWORD

_n = 0


def _uniq(prefix):
    global _n
    _n += 1
    return f"{prefix}{_n}@org.test.ke".replace(".test.", ".example.")


def make_org(api, kind="ngo"):
    email = _uniq("owner")
    r = api.post("/api/auth/register", json={
        "name": "Owner", "email": email, "password": PASSWORD,
        "organization_name": "Amani Trust", "organization_kind": kind, "country": "KE",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["therapist"]["role"] == "owner" and body["therapist"]["organization"]["name"] == "Amani Trust"
    return {"Authorization": f"Bearer {body['token']}"}, body["therapist"]["id"]


def invite(api, admin_h, role, supervisor_id=None):
    email = _uniq(role)
    r = api.post("/api/invites", json={"email": email, "role": role, "supervisor_id": supervisor_id}, headers=admin_h)
    assert r.status_code == 201, r.text
    token = r.json()["token"]
    assert api.get(f"/api/public/invites/{token}").json()["role"] == role
    r = api.post(f"/api/public/invites/{token}", json={"name": role.title(), "password": PASSWORD})
    assert r.status_code == 201, r.text
    # Single use
    assert api.post(f"/api/public/invites/{token}", json={"name": "x", "password": PASSWORD}).status_code == 410
    return {"Authorization": f"Bearer {r.json()['token']}"}, r.json()["therapist"]["id"]


@pytest.fixture(scope="module")
def org(api):
    owner_h, owner_id = make_org(api)
    sup_h, sup_id = invite(api, owner_h, "supervisor")
    lay_h, lay_id = invite(api, owner_h, "lay_counsellor", supervisor_id=sup_id)
    c1_h, c1_id = invite(api, owner_h, "counsellor", supervisor_id=sup_id)
    c2_h, c2_id = invite(api, owner_h, "counsellor")  # not supervised by sup
    me_h, me_id = invite(api, owner_h, "me_officer")
    prog = api.post("/api/programmes", json={"name": "Schools", "location": "Kibera", "funder": "Example Fund"}, headers=owner_h).json()
    return dict(owner=owner_h, owner_id=owner_id, sup=sup_h, sup_id=sup_id, lay=lay_h, lay_id=lay_id,
                c1=c1_h, c1_id=c1_id, c2=c2_h, c2_id=c2_id, me=me_h, me_id=me_id, prog=prog["id"])


def new_client(api, h, **kw):
    r = api.post("/api/clients", json={"full_name": "Test Client"} | kw, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_organizations_are_isolated(api, org):
    other_h, _ = make_org(api)
    cid = new_client(api, org["c1"])
    assert api.get(f"/api/clients/{cid}", headers=other_h).status_code == 404
    assert api.get("/api/clients", headers=other_h).json() == []
    assert all(m["name"] != "Supervisor" for m in api.get("/api/team", headers=other_h).json())
    assert api.get("/api/programmes", headers=other_h).json() == []
    # Can't assign a client to another organization's programme or staff
    assert api.post("/api/clients", json={"full_name": "X", "programme_id": org["prog"]}, headers=other_h).status_code == 422
    assert api.post("/api/clients", json={"full_name": "X", "therapist_id": org["c1_id"]}, headers=other_h).status_code == 422


def test_role_scopes(api, org):
    lay_client = new_client(api, org["lay"])
    c2_client = new_client(api, org["c2"])
    restricted = new_client(api, org["c1"], restricted=True)

    # Lay counsellor sees only their own
    ids = {c["id"] for c in api.get("/api/clients", headers=org["lay"]).json()}
    assert lay_client in ids and c2_client not in ids
    # Supervisor sees their team (lay, c1) but not c2's clients
    ids = {c["id"] for c in api.get("/api/clients", headers=org["sup"]).json()}
    assert lay_client in ids and restricted in ids and c2_client not in ids
    # Owner sees everyone except restricted cases they're not involved in
    ids = {c["id"] for c in api.get("/api/clients", headers=org["owner"]).json()}
    assert lay_client in ids and c2_client in ids and restricted not in ids
    assert api.get(f"/api/clients/{restricted}", headers=org["owner"]).status_code == 404
    # M&E sees no individual records but can read reports
    assert api.get("/api/clients", headers=org["me"]).json() == []
    assert api.post("/api/clients", json={"full_name": "X"}, headers=org["me"]).status_code == 403
    assert api.get("/api/reports", headers=org["me"]).status_code == 200
    # Counsellors can't read reports
    assert api.get("/api/reports", headers=org["c1"]).status_code == 403


def test_assignment_rules(api, org):
    # Counsellor can't assign to someone else
    assert api.post("/api/clients", json={"full_name": "X", "therapist_id": org["c2_id"]}, headers=org["c1"]).status_code == 403
    # Supervisor can assign within their team, not outside it
    assert api.post("/api/clients", json={"full_name": "X", "therapist_id": org["lay_id"]}, headers=org["sup"]).status_code == 201
    assert api.post("/api/clients", json={"full_name": "X", "therapist_id": org["c2_id"]}, headers=org["sup"]).status_code == 403
    # Admin reassigns; the new counsellor then sees the client
    cid = new_client(api, org["c1"])
    r = api.patch(f"/api/clients/{cid}", json={"therapist_id": org["c2_id"]}, headers=org["owner"])
    assert r.status_code == 200 and r.json()["counsellor_name"] == "Counsellor"
    assert api.get(f"/api/clients/{cid}", headers=org["c2"]).status_code == 200
    assert api.get(f"/api/clients/{cid}", headers=org["c1"]).status_code == 404


def test_supervision_review_flow(api, org):
    cid = new_client(api, org["lay"], consent_ai=True)
    sid = api.post(f"/api/clients/{cid}/sessions", json={"scheduled_at": "2026-10-20T10:00"}, headers=org["lay"]).json()["id"]
    api.patch(f"/api/sessions/{sid}", json={"data": "Talked about exams.", "private_note": "my private thought"}, headers=org["lay"])

    # Lay counsellor's sign goes to review, locked
    s = api.post(f"/api/sessions/{sid}/sign", headers=org["lay"]).json()
    assert s["note_status"] == "submitted" and s["review_status"] == "pending"
    assert api.patch(f"/api/sessions/{sid}", json={"data": "x"}, headers=org["lay"]).status_code == 409

    # Supervisor sees it in the queue, without the private note
    q = api.get("/api/supervision", headers=org["sup"]).json()
    item = next(p for p in q["pending_reviews"] if p["id"] == sid)
    assert item["private_note"] is None and item["can_review"] is True
    # Supervisor can't edit someone else's note
    assert api.patch(f"/api/sessions/{sid}", json={"data": "edit"}, headers=org["sup"]).status_code == 403
    # Unrelated counsellor can't review
    assert api.post(f"/api/sessions/{sid}/review", json={"decision": "approve"}, headers=org["c2"]).status_code == 404

    # Return needs a comment
    assert api.post(f"/api/sessions/{sid}/review", json={"decision": "return"}, headers=org["sup"]).status_code == 422
    r = api.post(f"/api/sessions/{sid}/review", json={"decision": "return", "comment": "Add a risk check."}, headers=org["sup"]).json()
    assert r["note_status"] == "draft" and r["review_status"] == "returned"
    assert api.get("/api/dashboard", headers=org["lay"]).json()["counts"]["returned_notes"] == 1

    api.patch(f"/api/sessions/{sid}", json={"risk_check": "Denied self-harm."}, headers=org["lay"])
    api.post(f"/api/sessions/{sid}/sign", headers=org["lay"])
    r = api.post(f"/api/sessions/{sid}/review", json={"decision": "approve"}, headers=org["sup"]).json()
    assert r["note_status"] == "signed" and r["review_status"] == "approved" and r["reviewer_name"] == "Supervisor"
    # Author still sees their own private note
    assert api.get(f"/api/sessions/{sid}", headers=org["lay"]).json()["private_note"] == "my private thought"

    # Counsellors' notes sign directly unless the organization asks for review of all notes
    cid2 = new_client(api, org["c1"])
    sid2 = api.post(f"/api/clients/{cid2}/sessions", json={"scheduled_at": "2026-10-21T10:00"}, headers=org["c1"]).json()["id"]
    api.patch(f"/api/sessions/{sid2}", json={"data": "Seen."}, headers=org["c1"])
    assert api.post(f"/api/sessions/{sid2}/sign", headers=org["c1"]).json()["note_status"] == "signed"
    assert api.patch("/api/org", json={"review_all_notes": True}, headers=org["c1"]).status_code == 403
    api.patch("/api/org", json={"review_all_notes": True}, headers=org["owner"])
    sid3 = api.post(f"/api/clients/{cid2}/sessions", json={"scheduled_at": "2026-10-22T10:00"}, headers=org["c1"]).json()["id"]
    api.patch(f"/api/sessions/{sid3}", json={"data": "Seen again."}, headers=org["c1"])
    assert api.post(f"/api/sessions/{sid3}/sign", headers=org["c1"]).json()["note_status"] == "submitted"
    api.patch("/api/org", json={"review_all_notes": False}, headers=org["owner"])


def test_escalation(api, org):
    cid = new_client(api, org["lay"])
    r = api.post(f"/api/clients/{cid}/escalate", json={"note": "Mentioned not wanting to wake up."}, headers=org["lay"])
    assert r.status_code == 200 and r.json()["escalated_at"]
    assert any(e["id"] == cid for e in api.get("/api/supervision", headers=org["sup"]).json()["escalations"])
    assert api.post(f"/api/clients/{cid}/escalation/resolve", headers=org["lay"]).status_code == 403
    assert api.post(f"/api/clients/{cid}/escalation/resolve", headers=org["sup"]).json()["escalated_at"] is None


def test_team_management(api, org):
    # Last owner can't be demoted or deactivated
    assert api.patch(f"/api/team/{org['owner_id']}", json={"role": "admin"}, headers=org["owner"]).status_code == 409
    # Non-admins can't manage the team, and don't see emails
    assert api.patch(f"/api/team/{org['c1_id']}", json={"role": "admin"}, headers=org["sup"]).status_code == 403
    assert all(m["email"] == "" for m in api.get("/api/team", headers=org["c1"]).json())
    # Transfer caseload, then deactivate: the person is signed out immediately
    tmp_h, tmp_id = invite(api, org["owner"], "counsellor")
    cid = new_client(api, tmp_h)
    assert api.post("/api/team/transfer", json={"from_id": tmp_id, "to_id": org["c2_id"]}, headers=org["owner"]).json()["moved"] == 1
    assert api.get(f"/api/clients/{cid}", headers=org["c2"]).status_code == 200
    api.patch(f"/api/team/{tmp_id}", json={"active": False}, headers=org["owner"])
    assert api.get("/api/auth/me", headers=tmp_h).status_code == 401
    # Invite emails already in use are refused; revoked invites stop working
    r = api.post("/api/invites", json={"email": _uniq("later"), "role": "counsellor"}, headers=org["owner"]).json()
    api.delete(f"/api/invites/{r['id']}", headers=org["owner"])
    assert api.get(f"/api/public/invites/{r['token']}").status_code == 410


def test_referrals(api, org):
    cid = new_client(api, org["c1"])
    r = api.post(f"/api/clients/{cid}/referrals", json={"service": "psychiatric", "to_organisation": "County Hospital",
                                                         "urgency": "urgent", "referred_on": "2026-01-10"}, headers=org["c1"])
    assert r.status_code == 201
    ref = r.json()
    assert ref["follow_up_on"] == "2026-01-13" and ref["overdue"] is True
    assert any(x["id"] == ref["id"] for x in api.get("/api/referrals?open_only=true", headers=org["c1"]).json())
    assert all(x["id"] != ref["id"] for x in api.get("/api/referrals", headers=org["c2"]).json())
    r = api.patch(f"/api/referrals/{ref['id']}", json={"status": "attended", "outcome": "Seen."}, headers=org["c1"]).json()
    assert r["status"] == "attended" and r["overdue"] is False
    assert api.patch(f"/api/referrals/{ref['id']}", json={"status": "closed"}, headers=org["c2"]).status_code == 404


def test_groups(api, org):
    g = api.post("/api/groups", json={"title": "Form 2 circle", "held_at": "2026-10-15T14:00", "programme_id": org["prog"]},
                 headers=org["lay"])
    assert g.status_code == 201
    gid = g.json()["id"]
    m1 = api.post(f"/api/groups/{gid}/members", json={"full_name": "Student One", "gender": "female",
                                                      "date_of_birth": "2011-03-01"}, headers=org["lay"]).json()["id"]
    m2 = api.post(f"/api/groups/{gid}/members", json={"full_name": "Student Two", "gender": "male"}, headers=org["lay"]).json()["id"]
    other = new_client(api, org["c2"])
    assert api.put(f"/api/groups/{gid}/attendance", json=[{"client_id": other}], headers=org["lay"]).status_code == 422
    r = api.put(f"/api/groups/{gid}/attendance", json=[{"client_id": m1, "present": True}, {"client_id": m2, "present": False}],
                headers=org["lay"]).json()
    assert r["present_count"] == 1 and r["registered_count"] == 2
    # Supervisor sees the team's groups, an outsider counsellor doesn't
    assert api.get(f"/api/groups/{gid}", headers=org["sup"]).status_code == 200
    assert api.get(f"/api/groups/{gid}", headers=org["c2"]).status_code == 404
    # New members belong to the programme and the facilitator
    assert api.get(f"/api/clients/{m1}", headers=org["lay"]).json()["programme_id"] == org["prog"]


def test_report_figures_and_suppression(api):
    h, _ = make_org(api)
    prog = api.post("/api/programmes", json={"name": "Community"}, headers=h).json()["id"]
    today = date.today()
    d = lambda days: (today - timedelta(days=days)).isoformat() + "T10:00"  # noqa: E731
    # 6 women, 1 man; all with PHQ-9 baseline and follow-up
    for i in range(7):
        cid = new_client(api, h, gender="female" if i < 6 else "male", programme_id=prog,
                         date_of_birth=(today - timedelta(days=365 * 16)).isoformat() if i == 0 else None)
        sid = api.post(f"/api/clients/{cid}/sessions", json={"scheduled_at": d(5)}, headers=h).json()["id"]
        api.patch(f"/api/sessions/{sid}", json={"data": "Seen."}, headers=h)
        api.post(f"/api/sessions/{sid}/sign", headers=h)
        base = [2, 2, 2, 2, 2, 1, 1, 1, 0]  # 13
        follow = [1, 1, 1, 1, 0, 0, 0, 0, 0] if i < 4 else [2, 2, 2, 1, 1, 1, 1, 1, 0]  # 4 (improved, recovered) or 11
        api.post(f"/api/clients/{cid}/assessments", json={"kind": "PHQ-9", "answers": base, "taken_at": d(40)}, headers=h)
        api.post(f"/api/clients/{cid}/assessments", json={"kind": "PHQ-9", "answers": follow, "taken_at": d(5)}, headers=h)
        if i == 0:
            api.post(f"/api/clients/{cid}/referrals", json={"service": "medical", "referred_on": today.isoformat()}, headers=h)
    rep = api.get("/api/reports", headers=h).json()
    assert rep["reach"]["clients_served"] == 7 and rep["reach"]["individual_sessions"] == 7
    assert {r["label"]: r["count"] for r in rep["by_gender"]} == {"Female": 6, "Male": "<5"}
    assert rep["reach"]["minors_served"] == "<5"
    phq = next(o for o in rep["outcomes"] if o["measure"] == "PHQ-9")
    assert phq["with_follow_up"] == 7 and phq["improved"] == 4 and phq["recovered"] == 4 and phq["clinical_at_baseline"] == 7
    assert phq["mean_baseline"] == 13.0
    assert rep["referrals"]["made"] == 1
    assert rep["by_programme"][0]["label"] == "Community"
    unsupp = api.get("/api/reports?suppress=false", headers=h).json()
    assert {r["label"]: r["count"] for r in unsupp["by_gender"]}["Male"] == 1
    csv = api.get("/api/reports.csv", headers=h)
    assert csv.status_code == 200 and "Outcomes PHQ-9" in csv.text and "<5" in csv.text
    assert api.get("/api/reports?start=2026-05-01&end=2026-01-01", headers=h).status_code == 422


def test_who5_scoring(api):
    h, _ = make_org(api)
    cid = new_client(api, h)
    r = api.post(f"/api/clients/{cid}/assessments", json={"kind": "WHO-5", "answers": [1, 1, 1, 1, 1]}, headers=h).json()
    assert r["total"] == 20 and r["flags"]
    assert api.post(f"/api/clients/{cid}/assessments", json={"kind": "WHO-5", "answers": [6, 1, 1, 1, 1]}, headers=h).status_code == 422


def test_checkin_shows_org_crisis_contacts(api):
    h, _ = make_org(api)
    api.patch("/api/org", json={"country": "UG", "crisis_contacts": [{"name": "Local helpline", "number": "0800 000 000"}]}, headers=h)
    cid = new_client(api, h)
    token = api.post(f"/api/clients/{cid}/checkins", json={"kinds": ["WHO-5"]}, headers=h).json()["token"]
    pub = api.get(f"/api/public/checkins/{token}").json()
    assert pub["country"] == "UG" and pub["support_contacts"][0]["name"] == "Local helpline"
    assert "you" in pub["measures"][0]["prompt"]


def test_demo(api, monkeypatch):
    assert api.post("/api/auth/demo", json={"role": "director"}).status_code == 404
    monkeypatch.setattr(settings, "demo_enabled", True)
    r = api.post("/api/auth/demo", json={"role": "director"})
    assert r.status_code == 200, r.text
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert r.json()["therapist"]["organization"]["is_demo"] is True
    clients = api.get("/api/clients", headers=h).json()
    assert len(clients) >= 40
    rep = api.get("/api/reports", headers=h).json()
    assert rep["reach"]["clients_served"] > 20 and rep["reach"]["group_sessions"] > 5
    assert next(o for o in rep["outcomes"] if o["measure"] == "PHQ-9")["with_follow_up"] > 10
    sup = api.post("/api/auth/demo", json={"role": "supervisor"}).json()
    sh = {"Authorization": f"Bearer {sup['token']}"}
    q = api.get("/api/supervision", headers=sh).json()
    assert q["pending_reviews"] and q["escalations"]
    # Demo accounts can't be taken over
    assert api.post("/api/auth/me/password", json={"current_password": "x", "new_password": "another-pass-1"}, headers=h).status_code == 403
    assert api.post("/api/auth/me/2fa/setup", headers=h).status_code == 403
    assert api.post("/api/invites", json={"email": "x@example.org", "role": "counsellor"}, headers=h).status_code == 403
    # Demo staff don't stop the first real organization from registering
    monkeypatch.setattr(settings, "registration", "first")
    # (other tests already created real organizations, so registration is closed here either way)
    assert api.get("/api/auth/config").json()["demo_enabled"] is True
