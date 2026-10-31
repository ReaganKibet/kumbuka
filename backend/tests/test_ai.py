"""AI providers and the free-tier safety gate. No network: provider calls are faked."""

import base64
import json

import pytest

from app import ai
from app.config import settings
from tests.helpers import signup

NOTE = {"data": "Client reported better sleep.", "assessment": "Improving.", "plan": "Continue.",
        "interventions": "Breathing.", "homework": "Thought log.", "risk_indicators": []}


class FakeResponse:
    def __init__(self, payload, status=200):
        self.status_code, self._payload, self.text = status, payload, json.dumps(payload)

    def json(self):
        return self._payload


@pytest.fixture
def gemini(monkeypatch):
    """Free Gemini key by default; returns the list of requests sent and a queue of answers."""
    sent, answers = [], []
    monkeypatch.setattr(settings, "gemini_api_key", "AIza-test")
    monkeypatch.setattr(settings, "gemini_billing_enabled", False)
    monkeypatch.setattr(settings, "anthropic_api_key", "")

    def fake_post(url, headers=None, json=None, timeout=None):
        sent.append({"url": url, "headers": headers, "json": json})
        text = answers.pop(0) if answers else "ok"
        return FakeResponse({"candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": "STOP"}]})

    monkeypatch.setattr(ai.httpx, "post", fake_post)
    return sent, answers


def demo_headers(api, monkeypatch, role="counsellor"):
    monkeypatch.setattr(settings, "demo_enabled", True)
    r = api.post("/api/auth/demo", json={"role": role})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}, r.json()["therapist"]


def test_gemini_draft_request_shape(gemini):
    sent, answers = gemini
    answers.append(json.dumps(NOTE))
    out = ai.draft_note("Slept better this week. We did breathing. She'll keep a thought log.")
    assert out["ai_used"] and out["data"] == NOTE["data"] and out["risk_indicators"] == []
    req = sent[0]
    assert req["url"].endswith(f"/models/{settings.gemini_model}:generateContent")
    assert req["headers"] == {"x-goog-api-key": "AIza-test"}
    cfg = req["json"]["generationConfig"]
    assert cfg["responseMimeType"] == "application/json" and cfg["responseSchema"]["type"] == "OBJECT"
    assert cfg["responseSchema"]["properties"]["risk_indicators"]["items"]["type"] == "STRING"
    assert {s["threshold"] for s in req["json"]["safetySettings"]} == {"BLOCK_NONE"}

    # If the model misses a risk mention, the keyword check still surfaces it.
    answers.append(json.dumps(NOTE))
    out = ai.draft_note("Hard week. He said he wants to die sometimes. We talked about work.")
    assert out["risk_indicators"] and "please check" in out["risk_indicators"][0]


def test_gemini_errors_fall_back(monkeypatch, gemini):
    monkeypatch.setattr(ai.httpx, "post", lambda *a, **k: FakeResponse({"error": {"message": "quota"}}, 429))
    out = ai.draft_note("Talked about exams and sleep. Wants to try a routine.")
    assert out["ai_used"] is False and "usage limit" in out["message"] and "exams" in out["data"]
    monkeypatch.setattr(ai.httpx, "post", lambda *a, **k: FakeResponse({"promptFeedback": {"blockReason": "SAFETY"}}))
    with pytest.raises(ai.AIError, match="declined"):
        ai.report_narrative({"reach": {}})


def test_anthropic_still_supported(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "")
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-test")
    seen = {}
    monkeypatch.setattr(ai, "_anthropic", lambda system, text, **kw: seen.update(kw) or json.dumps(NOTE))
    assert settings.ai_provider == "anthropic" and settings.ai_real_data
    assert ai.draft_note("Slept better this week, did breathing.")["ai_used"]
    assert seen["schema"] == ai.NOTE_SCHEMA
    assert not ai.can_transcribe()


def test_free_gemini_key_never_touches_real_clients(api, gemini, monkeypatch):
    sent, answers = gemini
    h = signup(api, "freetier@test.ke")
    me = api.get("/api/auth/me", headers=h).json()
    assert me["ai_available"] is False and me["can_transcribe"] is False
    cfg = api.get("/api/auth/config").json()
    assert cfg["ai_enabled"] and cfg["ai_provider"] == "gemini" and cfg["ai_real_data"] is False

    cid = api.post("/api/clients", json={"full_name": "Real Person", "consent_ai": True}, headers=h).json()["id"]
    sid = api.post(f"/api/clients/{cid}/sessions", json={"scheduled_at": "2026-10-05T09:00"}, headers=h).json()["id"]
    r = api.post(f"/api/sessions/{sid}/ai-draft", json={"dictation": "Talked about grief and sleep."}, headers=h).json()
    assert r["ai_used"] is False and "demo" in r["message"]
    brief = api.get(f"/api/clients/{cid}/brief", headers=h).json()
    assert brief["ai_used"] is False
    up = api.post(f"/api/sessions/{sid}/transcribe", content=b"x" * 5000, headers=h | {"Content-Type": "audio/webm"})
    assert up.status_code == 403
    assert sent == [], "no real client data may reach a free Gemini key"

    # Paid key: real clients are allowed
    monkeypatch.setattr(settings, "gemini_billing_enabled", True)
    answers.append(json.dumps(NOTE))
    r = api.post(f"/api/sessions/{sid}/ai-draft", json={"dictation": "Talked about grief and sleep."}, headers=h).json()
    assert r["ai_used"] is True and "Real Person" not in json.dumps(sent[-1]["json"])


def test_demo_transcription_and_draft_on_free_key(api, gemini, monkeypatch):
    sent, answers = gemini
    h, me = demo_headers(api, monkeypatch)
    assert me["ai_available"] and me["can_transcribe"]
    clients = api.get("/api/clients", headers=h).json()
    cid = next(c["id"] for c in clients if not c["restricted"])
    client = api.get(f"/api/clients/{cid}", headers=h).json()
    if not client["consent_ai"]:
        api.patch(f"/api/clients/{cid}", json={"consent_ai": True}, headers=h)
    sid = api.post(f"/api/clients/{cid}/sessions", json={"scheduled_at": "2026-10-28T09:00"}, headers=h).json()["id"]
    audio = b"\x1aE\xdf\xa3" + b"\x00" * 6000
    url = f"/api/sessions/{sid}/transcribe"

    # A full session recording needs the client's agreement to be recorded
    assert api.post(f"{url}?mode=session", content=audio, headers=h | {"Content-Type": "audio/webm"}).status_code == 400
    answers.append("Counsellor: How was the week?\nClient: Better, I slept more.")
    r = api.post(f"{url}?mode=session&recording_consent=true&seconds=42", content=audio,
                 headers=h | {"Content-Type": "audio/webm;codecs=opus"})
    assert r.status_code == 200, r.text
    assert r.json()["transcript"].startswith("Counsellor:")
    part = sent[-1]["json"]["contents"][0]["parts"][0]["inlineData"]
    assert part["mimeType"] == "audio/webm" and base64.b64decode(part["data"]) == audio
    log = api.get("/api/audit", headers=h).json()
    assert any(e["action"] == "transcribe" and "agreed to recording" in (e["detail"] or "") for e in log)

    # Unsupported and oversized audio are refused before reaching Gemini
    n = len(sent)
    assert api.post(url, content=audio, headers=h | {"Content-Type": "text/plain"}).status_code == 502
    assert api.post(url, content=b"x" * (ai.MAX_AUDIO_BYTES + 1), headers=h | {"Content-Type": "audio/webm"}).status_code == 413
    assert len(sent) == n

    answers.append(json.dumps(NOTE))
    d = api.post(f"/api/sessions/{sid}/ai-draft", json={"dictation": r.json()["transcript"]}, headers=h).json()
    assert d["ai_used"] is True


def test_report_narrative_sends_only_anonymised_figures(api, gemini, monkeypatch):
    sent, answers = gemini
    h, _ = demo_headers(api, monkeypatch, role="me")
    answers.append("Between July and October the programme reached 46 people.")
    r = api.post("/api/reports/narrative", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["narrative"].startswith("Between")
    payload = json.dumps(sent[-1]["json"])
    assert "Tumaini" not in payload and "funder" not in sent[-1]["json"]["contents"][0]["parts"][0]["text"]
    names = [c["full_name"] for c in api.get("/api/clients", headers=demo_headers(api, monkeypatch, "director")[0]).json()]
    assert not any(n in payload for n in names)

    # Real organisations get the narrative too, even on a free key: it's aggregate, suppressed data.
    real = signup(api, "narrative@test.ke")
    answers.append("No activity yet.")
    assert api.post("/api/reports/narrative", headers=real).status_code == 200


def test_ai_off_everywhere_without_a_key(api):
    h = signup(api, "nokey@test.ke")
    assert api.post("/api/reports/narrative", headers=h).status_code == 403
    assert api.get("/api/auth/config").json()["ai_provider"] is None
