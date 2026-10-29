import pytest

from app.measures import score
from helpers import signup


# ---------- scoring ----------
def test_phq9_scoring_and_item9_flag():
    r = score("PHQ-9", [1, 1, 1, 1, 1, 1, 1, 1, 1])
    assert r["total"] == 9 and r["severity"] == "Mild"
    assert any("Item 9" in f for f in r["flags"])
    assert score("PHQ-9", [3] * 8 + [0])["severity"] == "Severe"
    assert score("PHQ-9", [0] * 9) == {"total": 0, "severity": "Minimal", "flags": []}


def test_gad7_bands():
    assert score("GAD-7", [2, 2, 2, 2, 2, 2, 2])["severity"] == "Moderate"
    assert score("GAD-7", [3] * 7)["severity"] == "Severe"


def test_bad_answers_rejected():
    with pytest.raises(ValueError):
        score("PHQ-9", [0] * 8)
    with pytest.raises(ValueError):
        score("GAD-7", [4] * 7)


# ---------- auth ----------
def test_auth_required(api):
    assert api.get("/api/clients").status_code == 401


def test_login_and_wrong_password(api):
    signup(api, "login@test.ke")
    assert api.post("/api/auth/login", json={"email": "LOGIN@test.ke", "password": "correct-horse-9"}).status_code == 200
    assert api.post("/api/auth/login", json={"email": "login@test.ke", "password": "nope-nope-nope"}).status_code == 401


# ---------- isolation ----------
def test_counselors_cannot_see_each_others_clients(api):
    a = signup(api, "a@test.ke")
    b = signup(api, "b@test.ke")
    cid = api.post("/api/clients", json={"full_name": "Wanjiku Kamau"}, headers=a).json()["id"]
    sid = api.post(f"/api/clients/{cid}/sessions", json={"scheduled_at": "2026-10-01T10:00"}, headers=a).json()["id"]

    assert api.get(f"/api/clients/{cid}", headers=b).status_code == 404
    assert api.get(f"/api/clients/{cid}/sessions", headers=b).status_code == 404
    assert api.get(f"/api/sessions/{sid}", headers=b).status_code == 404
    assert api.patch(f"/api/sessions/{sid}", json={"data": "x"}, headers=b).status_code == 404
    assert api.get("/api/clients", headers=b).json() == []


# ---------- notes ----------
def test_note_lifecycle_sign_lock_addendum(api):
    h = signup(api, "notes@test.ke")
    cid = api.post("/api/clients", json={"full_name": "Otieno Odhiambo", "consent_ai": True}, headers=h).json()["id"]
    sid = api.post(f"/api/clients/{cid}/sessions", json={"scheduled_at": "2026-10-02T09:00"}, headers=h).json()["id"]

    # cannot sign an empty note
    assert api.post(f"/api/sessions/{sid}/sign", headers=h).status_code == 422

    r = api.patch(f"/api/sessions/{sid}", json={"data": "Client reported better sleep.", "mood_rating": 6}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "attended"

    assert api.post(f"/api/sessions/{sid}/sign", headers=h).json()["note_status"] == "signed"
    assert api.patch(f"/api/sessions/{sid}", json={"data": "changed"}, headers=h).status_code == 409
    assert api.delete(f"/api/sessions/{sid}", headers=h).status_code == 409
    # private note stays editable
    assert api.patch(f"/api/sessions/{sid}", json={"private_note": "think about grief"}, headers=h).status_code == 200

    r = api.post(f"/api/sessions/{sid}/addenda", json={"text": "Correction: mood was 5."}, headers=h)
    assert r.status_code == 201 and r.json()["addenda"][0]["text"] == "Correction: mood was 5."


def test_ai_draft_needs_consent_and_falls_back(api):
    h = signup(api, "ai@test.ke")
    no = api.post("/api/clients", json={"full_name": "No Consent"}, headers=h).json()["id"]
    sid = api.post(f"/api/clients/{no}/sessions", json={"scheduled_at": "2026-10-03T09:00"}, headers=h).json()["id"]
    assert api.post(f"/api/sessions/{sid}/ai-draft", json={"dictation": "Talked about work stress."}, headers=h).status_code == 403

    yes = api.post("/api/clients", json={"full_name": "Has Consent", "consent_ai": True}, headers=h).json()["id"]
    sid = api.post(f"/api/clients/{yes}/sessions", json={"scheduled_at": "2026-10-03T11:00"}, headers=h).json()["id"]
    r = api.post(
        f"/api/sessions/{sid}/ai-draft",
        json={"dictation": "Talked about work stress. She mentioned she sometimes thinks about self-harm when overwhelmed."},
        headers=h,
    )
    body = r.json()
    assert r.status_code == 200 and body["ai_used"] is False
    assert "work stress" in body["data"]
    assert body["risk_indicators"], "keyword fallback should catch the self-harm mention"


def test_assessments_goals_brief_dashboard_export(api):
    h = signup(api, "flow@test.ke")
    cid = api.post(
        "/api/clients", json={"full_name": "Achieng Atieno", "presenting_concern": "Exam anxiety"}, headers=h
    ).json()["id"]

    r = api.post(f"/api/clients/{cid}/assessments", json={"kind": "GAD-7", "answers": [2] * 7, "taken_at": "2026-10-01T10:00"}, headers=h)
    assert r.status_code == 201 and r.json()["total"] == 14
    api.post(f"/api/clients/{cid}/assessments", json={"kind": "GAD-7", "answers": [1] * 7, "taken_at": "2026-10-15T10:00"}, headers=h)
    assert api.post(f"/api/clients/{cid}/assessments", json={"kind": "PHQ-9", "answers": [1] * 3}, headers=h).status_code == 422
    flagged = api.post(f"/api/clients/{cid}/assessments", json={"kind": "PHQ-9", "answers": [0] * 8 + [1]}, headers=h).json()
    assert flagged["flags"]

    gid = api.post(f"/api/clients/{cid}/goals", json={"description": "Sleep 7 hours on weeknights"}, headers=h).json()["id"]
    assert api.patch(f"/api/goals/{gid}", json={"status": "achieved"}, headers=h).json()["progress"] == 100

    sid = api.post(f"/api/clients/{cid}/sessions", json={"scheduled_at": "2026-10-15T10:00"}, headers=h).json()["id"]
    api.patch(f"/api/sessions/{sid}", json={"data": "Prepared for exams.", "homework": "Breathing practice daily",
                                           "private_note": "secret"}, headers=h)

    brief = api.get(f"/api/clients/{cid}/brief", headers=h).json()
    gad = next(s for s in brief["latest_scores"] if s["kind"] == "GAD-7")
    assert gad["total"] == 7 and gad["change"] == -7
    assert brief["last_homework"] == "Breathing practice daily"
    assert brief["open_flags"]

    dash = api.get("/api/dashboard", headers=h).json()
    assert any(s["id"] == sid for s in dash["unsigned"])
    assert any(a["client_id"] == cid for a in dash["attention"])

    clients = api.get("/api/clients", headers=h).json()
    assert clients[0]["unsigned_notes"] == 1 and clients[0]["session_count"] == 1

    export = api.get(f"/api/clients/{cid}/export", headers=h).json()
    assert "private_note" not in export["sessions"][0]

    actions = {row["action"] for row in api.get("/api/audit", headers=h).json()}
    assert {"create", "update", "view_brief", "export"} <= actions


def test_ai_draft_parses_model_output(monkeypatch):
    """The AI path: model output (a forced tool call) becomes the draft; no names sent."""
    from types import SimpleNamespace

    from app import ai
    from app.config import settings

    sent = {}

    class FakeMessages:
        def create(self, **kw):
            sent.update(kw)
            return SimpleNamespace(content=[SimpleNamespace(type="tool_use", input={
                "data": "Client reported better sleep.", "assessment": "Improving.", "plan": "Continue.",
                "interventions": "Breathing.", "homework": "Thought log.", "risk_indicators": [],
            })])

    monkeypatch.setattr(settings, "anthropic_api_key", "sk-test")
    monkeypatch.setattr(ai, "_client", lambda: SimpleNamespace(messages=FakeMessages()))

    out = ai.draft_note("Slept better this week. We did breathing. She'll keep a thought log.")
    assert out["ai_used"] and out["data"] == "Client reported better sleep." and out["risk_indicators"] == []
    assert sent["tool_choice"] == {"type": "tool", "name": "record_dap_note"}

    # If the model misses a risk mention, the keyword check still surfaces it.
    out = ai.draft_note("Hard week. He said he wants to die sometimes. We talked about work.")
    assert out["risk_indicators"] and "please check" in out["risk_indicators"][0]
