from helpers import signup


def _client(api, h, **kw):
    body = {"full_name": "Wairimu Njoki Kariuki", "preferred_name": "Wairimu"} | kw
    return api.post("/api/clients", json=body, headers=h).json()["id"]


def test_checkin_full_flow(api):
    h = signup(api, "checkin@test.ke")
    cid = _client(api, h)
    r = api.post(f"/api/clients/{cid}/checkins", json={"kinds": ["PHQ-9", "GAD-7"], "days": 3}, headers=h)
    assert r.status_code == 201
    token = r.json()["token"]
    assert r.json()["status"] == "pending"

    # The listing never exposes the token.
    listed = api.get(f"/api/clients/{cid}/checkins", headers=h).json()
    assert "token" not in listed[0]

    # Client opens the link without signing in.
    pub = api.get(f"/api/public/checkins/{token}")
    assert pub.status_code == 200
    body = pub.json()
    assert body["first_name"] == "Wairimu" and [m["kind"] for m in body["measures"]] == ["PHQ-9", "GAD-7"]
    assert "full_name" not in body and "phone" not in body

    # Incomplete answers are refused.
    bad = api.post(f"/api/public/checkins/{token}", json={"answers": {"PHQ-9": [0] * 9}})
    assert bad.status_code == 422

    ok = api.post(f"/api/public/checkins/{token}", json={
        "answers": {"PHQ-9": [1, 1, 1, 1, 1, 1, 1, 1, 1], "GAD-7": [2] * 7}, "mood": 4,
        "message": "Work has been hard this week.",
    })
    assert ok.status_code == 200 and ok.json()["show_support"] is True  # item 9 endorsed

    # One use only.
    assert api.post(f"/api/public/checkins/{token}", json={"answers": {"PHQ-9": [0] * 9, "GAD-7": [0] * 7}}).status_code == 410
    assert api.get(f"/api/public/checkins/{token}").status_code == 410

    scores = api.get(f"/api/clients/{cid}/assessments", headers=h).json()
    assert {s["kind"] for s in scores} == {"PHQ-9", "GAD-7"} and all(s["source"] == "client" for s in scores)

    brief = api.get(f"/api/clients/{cid}/brief?ai=false", headers=h).json()
    assert brief["latest_checkin"]["message"] == "Work has been hard this week." and brief["latest_checkin"]["mood"] == 4

    dash = api.get("/api/dashboard", headers=h).json()
    assert dash["checkins"][0]["client_id"] == cid and dash["checkins"][0]["flagged"] is True


def test_checkin_revoke_unknown_and_isolation(api):
    h = signup(api, "checkin2@test.ke")
    other = signup(api, "checkin3@test.ke")
    cid = _client(api, h)
    r = api.post(f"/api/clients/{cid}/checkins", json={"kinds": ["GAD-7"]}, headers=h).json()
    assert api.delete(f"/api/checkins/{r['id']}", headers=other).status_code == 404
    assert api.delete(f"/api/checkins/{r['id']}", headers=h).json()["status"] == "revoked"
    assert api.get(f"/api/public/checkins/{r['token']}").status_code == 410
    assert api.get("/api/public/checkins/not-a-real-token").status_code == 404
    assert api.post(f"/api/clients/{cid}/checkins", json={"kinds": ["MADE-UP"]}, headers=h).status_code == 422
    assert api.get(f"/api/clients/{cid}/checkins", headers=other).status_code == 404


def test_letters(api):
    h = signup(api, "letters@test.ke")
    api.patch("/api/auth/me", json={"title": "Counselling Psychologist", "practice_name": "Tulia Counselling"}, headers=h)
    cid = _client(api, h, presenting_concern="Low mood after job loss")
    for day in ("2026-09-01T10:00", "2026-09-15T10:00"):
        sid = api.post(f"/api/clients/{cid}/sessions", json={"scheduled_at": day}, headers=h).json()["id"]
        api.patch(f"/api/sessions/{sid}", json={"status": "attended", "data": "Seen."}, headers=h)

    d = api.post(f"/api/clients/{cid}/letters/draft", json={"kind": "attendance"}, headers=h).json()
    assert "2 counseling sessions between 1 September 2026 and 15 September 2026" in d["body"]
    assert "Tulia Counselling" in d["body"] and "Counselling Psychologist" in d["body"]

    ref = api.post(f"/api/clients/{cid}/letters/draft",
                   json={"kind": "referral", "recipient": "Dr Otieno\nKenyatta National Hospital", "reason": "Sleep assessment", "use_ai": True},
                   headers=h).json()
    assert ref["ai_used"] is False and "Dear Dr Otieno," in ref["body"] and "Sleep assessment" in ref["body"]

    lid = api.post(f"/api/clients/{cid}/letters", json={"kind": "attendance", "subject": d["subject"], "body": d["body"]}, headers=h).json()["id"]
    assert api.patch(f"/api/letters/{lid}", json={"body": "Edited."}, headers=h).json()["body"] == "Edited."
    assert len(api.get(f"/api/clients/{cid}/letters", headers=h).json()) == 1

    other = signup(api, "letters2@test.ke")
    assert api.get(f"/api/letters/{lid}", headers=other).status_code == 404
    assert api.post(f"/api/clients/{cid}/letters/draft", json={"kind": "general"}, headers=other).status_code == 404

    assert api.post("/api/audit-events", json={"action": "print", "entity": "letter", "entity_id": lid}, headers=h).status_code == 204
    export = api.get(f"/api/clients/{cid}/export", headers=h).json()
    assert export["letters"][0]["body"] == "Edited."
