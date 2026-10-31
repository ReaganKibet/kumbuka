"""Offline field packs, idempotent sync, field identifiers and the IASC report."""

import uuid

from test_org import invite, make_org

U = lambda: str(uuid.uuid4())  # noqa: E731


def test_field_identifiers_round_trip(api):
    owner_h, _ = make_org(api)
    body = {"full_name": "Amina Hassan", "unhcr_case_no": "KAK-123-45678", "primero_case_id": "CP-0042",
            "settlement": "Kakuma 3", "block": "Zone 2, Block 7", "preferred_language": "Somali",
            "interpreter_needed": True}
    c = api.post("/api/clients", json=body, headers=owner_h).json()
    assert {k: c[k] for k in body} == body
    assert api.patch(f"/api/clients/{c['id']}", json={"interpreter_needed": None}, headers=owner_h).json()["interpreter_needed"] is True
    sid = api.post(f"/api/clients/{c['id']}/sessions", json={"scheduled_at": "2026-10-20T10:00"}, headers=owner_h).json()["id"]
    s = api.patch(f"/api/sessions/{sid}", json={"setting": "home_visit", "language": "Somali", "interpreter_used": True,
                                                  "data": "Discussed sleep."}, headers=owner_h).json()
    assert (s["setting"], s["language"], s["interpreter_used"]) == ("home_visit", "Somali", True)
    assert api.patch(f"/api/sessions/{sid}", json={"setting": "boat"}, headers=owner_h).status_code == 422


def test_pack_holds_only_own_active_clients_and_minimal_fields(api):
    owner_h, _ = make_org(api)
    c1_h, _ = invite(api, owner_h, "counsellor")
    c2_h, _ = invite(api, owner_h, "counsellor")
    mine = api.post("/api/clients", json={"full_name": "Mine", "background": "Long history", "email": "m@example.org",
                                          "date_of_birth": "2010-05-01"}, headers=c1_h).json()
    api.post("/api/clients", json={"full_name": "Closed", "status": "closed"}, headers=c1_h)
    api.post("/api/clients", json={"full_name": "Someone else's"}, headers=c2_h)
    pack = api.get("/api/field/pack", headers=c1_h).json()
    assert [c["full_name"] for c in pack["clients"]] == ["Mine"]
    entry = pack["clients"][0]
    assert entry["id"] == mine["id"] and isinstance(entry["age"], int)
    assert not {"background", "email", "date_of_birth", "private_note"} & set(entry)
    assert {m["kind"] for m in pack["measures"]} >= {"PHQ-9", "GAD-7", "WHO-5"}
    assert pack["expires_at"] > pack["generated_at"]
    # M&E officers can't take records into the field
    me_h, _ = invite(api, owner_h, "me_officer")
    assert api.get("/api/field/pack", headers=me_h).status_code == 403


def test_offline_sync_is_idempotent_and_isolates_errors(api):
    owner_h, _ = make_org(api)
    lay_h, lay_id = invite(api, owner_h, "lay_counsellor")
    existing = api.post("/api/clients", json={"full_name": "Existing Client"}, headers=lay_h).json()
    group = api.post("/api/groups", json={"title": "Girls' circle", "held_at": "2026-10-30T14:00", "status": "scheduled"},
                     headers=lay_h).json()

    new_client = U()
    items = [
        {"offline_id": new_client, "kind": "client",
         "data": {"full_name": "New In The Field", "gender": "female", "date_of_birth": "2011-02-02",
                  "settlement": "Kalobeyei", "consent_signed": True, "guardian_name": "Mama Joy"}},
        {"offline_id": U(), "kind": "session", "client_offline_id": new_client,
         "data": {"scheduled_at": "2026-10-30T10:15:00+03:00", "status": "attended", "setting": "outreach",
                  "language": "Kiswahili", "notes": "First meeting under the tree. Worried about school fees.",
                  "risk_check": "Denied self-harm.", "mood_rating": 4}},
        {"offline_id": U(), "kind": "assessment", "client_id": existing["id"],
         "data": {"kind": "PHQ-9", "answers": [1, 1, 2, 1, 0, 1, 1, 0, 1], "taken_at": "2026-10-30T11:00:00"}},
        {"offline_id": U(), "kind": "assessment", "client_id": existing["id"],
         "data": {"kind": "PHQ-9", "answers": [1, 2], "taken_at": "2026-10-30T11:05:00"}},
        {"offline_id": U(), "kind": "attendance",
         "data": {"group_id": group["id"], "present": [existing["id"]], "present_offline": [new_client]}},
    ]
    r = api.post("/api/field/sync", json={"items": items}, headers=lay_h)
    assert r.status_code == 200, r.text
    res = r.json()
    assert [x["status"] for x in res] == ["created", "created", "created", "error", "created"]
    assert "9 answers" in res[3]["message"]

    cid = res[0]["object_id"]
    c = api.get(f"/api/clients/{cid}", headers=lay_h).json()
    assert c["referral_source"] == "field" and c["settlement"] == "Kalobeyei"
    s = api.get(f"/api/sessions/{res[1]['object_id']}", headers=lay_h).json()
    assert s["note_status"] == "draft" and s["setting"] == "outreach" and s["scheduled_at"].startswith("2026-10-30T10:15")
    assert "school fees" in s["dictation"]
    g = api.get(f"/api/groups/{group['id']}", headers=lay_h).json()
    assert g["status"] == "held" and g["present_count"] == 2
    item9 = api.get(f"/api/clients/{existing['id']}/assessments", headers=lay_h).json()
    assert len(item9) == 1 and item9[0]["flags"]

    # The same upload again (a retry after a dropped connection) creates nothing new
    again = api.post("/api/field/sync", json={"items": items}, headers=lay_h).json()
    assert [x["status"] for x in again] == ["duplicate", "duplicate", "duplicate", "error", "duplicate"]
    assert len(api.get(f"/api/clients/{existing['id']}/assessments", headers=lay_h).json()) == 1
    assert sum(1 for x in api.get("/api/clients", headers=lay_h).json() if x["full_name"] == "New In The Field") == 1

    # A later upload can still refer to the client created earlier
    later = api.post("/api/field/sync", json={"items": [
        {"offline_id": U(), "kind": "session", "client_offline_id": new_client,
         "data": {"scheduled_at": "2026-10-31T09:00:00", "notes": "Follow-up visit."}}]}, headers=lay_h).json()
    assert later[0]["status"] == "created"

    # Another counsellor can't touch these records or reuse the ids
    other_h, _ = invite(api, owner_h, "counsellor")
    hijack = api.post("/api/field/sync", json={"items": [
        {"offline_id": items[1]["offline_id"], "kind": "session", "client_id": existing["id"],
         "data": {"scheduled_at": "2026-10-31T09:00:00"}},
        {"offline_id": U(), "kind": "session", "client_id": existing["id"], "data": {"scheduled_at": "2026-10-31T09:00:00"}},
        {"offline_id": U(), "kind": "session", "client_offline_id": new_client, "data": {"scheduled_at": "2026-10-31T09:00:00"}},
    ]}, headers=other_h).json()
    assert [x["status"] for x in hijack] == ["error", "error", "error"]

    # Too many items or a malformed id are refused outright
    assert api.post("/api/field/sync", json={"items": [{"offline_id": "nope", "kind": "client", "data": {}}]},
                    headers=lay_h).status_code == 422


def test_report_has_iasc_indicators(api):
    owner_h, _ = make_org(api)
    sup_h, sup_id = invite(api, owner_h, "supervisor")
    lay_h, _ = invite(api, owner_h, "lay_counsellor", supervisor_id=sup_id)
    for name, gender, dob in [("Girl", "female", "2012-01-01"), ("Woman", "female", "1990-01-01"),
                              ("Boy", "male", "2013-01-01"), ("Man", "male", "1985-01-01"), ("Unknown", None, None)]:
        c = api.post("/api/clients", json={"full_name": name, "gender": gender, "date_of_birth": dob}, headers=lay_h).json()
        sid = api.post(f"/api/clients/{c['id']}/sessions", json={"scheduled_at": "2026-10-10T09:00"}, headers=lay_h).json()["id"]
        api.patch(f"/api/sessions/{sid}", json={"data": "Session held.", "setting": "school", "language": "Kiswahili"}, headers=lay_h)
        api.post(f"/api/sessions/{sid}/sign", headers=lay_h)
        if name == "Girl":
            assert api.post(f"/api/sessions/{sid}/review", json={"decision": "approve"}, headers=sup_h).status_code == 200
    rep = api.get("/api/reports?start=2026-10-01&end=2026-10-31&suppress=false", headers=owner_h).json()
    iasc = rep["iasc"]
    assert iasc["focused_care"] == {"women": 1, "men": 1, "girls": 1, "boys": 1, "other_or_unknown": 1, "total": 5}
    assert iasc["supervision"] == {"delivering_staff": 1, "with_supervisor": 1, "supervised_in_period": 1, "pct": 100.0}
    assert iasc["by_setting"] == [{"label": "School", "count": 5}]
    codes = [r["code"] for r in iasc["indicators"]]
    assert codes[:2] == ["O5.4", "Gi.3"] and "O5.2" in codes and "Gi.1" in codes
    # Suppressed by default: single people show as "<5"
    sup = api.get("/api/reports?start=2026-10-01&end=2026-10-31", headers=owner_h).json()["iasc"]["focused_care"]
    assert sup["girls"] == "<5" and sup["total"] == 5
    csv = api.get("/api/reports.csv?start=2026-10-01&end=2026-10-31", headers=owner_h).text
    assert "IASC MHPSS O5.4" in csv and "Sessions by setting" in csv
