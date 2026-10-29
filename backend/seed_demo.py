"""Fill a fresh database with a demo account and three fictional clients.

    python seed_demo.py            # uses DATABASE_URL from .env
Login: demo@example.com / demo-password
Never run this against the real database.
"""

from datetime import timedelta

from fastapi.testclient import TestClient

from app.config import local_now
from app.main import app

EMAIL, PASSWORD = "demo@example.com", "demo-password"


def iso(dt):
    return dt.replace(second=0, microsecond=0).isoformat()


def main():
    now = local_now()
    with TestClient(app) as api:
        r = api.post("/api/auth/register", json={"name": "Grace Wambui", "email": EMAIL, "password": PASSWORD})
        if r.status_code == 409:
            print("Demo account already exists.")
            return
        h = {"Authorization": f"Bearer {r.json()['token']}"}
        api.patch("/api/auth/me", json={
            "title": "Counselling Psychologist", "practice_name": "Tulia Counselling Centre",
            "phone": "0700 000 000", "address": "2nd Floor, Example House\nNgong Road, Nairobi",
            "license_no": "DEMO-0000",
        }, headers=h)

        def client(**kw):
            return api.post("/api/clients", json=kw, headers=h).json()["id"]

        def session(cid, when, **note):
            when = when.replace(hour=when.hour if 8 <= when.hour <= 17 else 10, minute=0)
            sid = api.post(f"/api/clients/{cid}/sessions", json={"scheduled_at": iso(when)}, headers=h).json()["id"]
            sign = note.pop("_sign", True)
            if note:
                api.patch(f"/api/sessions/{sid}", json=note, headers=h)
                if sign:
                    api.post(f"/api/sessions/{sid}/sign", headers=h)
            return sid

        # 1. Anxiety around exams, improving
        a = client(
            full_name="Achieng Atieno Odhiambo", preferred_name="Achieng", date_of_birth="2003-04-12",
            phone="0712 000 111", presenting_concern="Panic before exams and trouble sleeping since starting final year at university.",
            background="Final-year nursing student, lives in a hostel. First in her family at university. No previous counseling.",
            consent_signed=True, consent_ai=True,
        )
        for weeks, answers in [(6, [2, 3, 2, 2, 2, 2, 2]), (4, [2, 2, 2, 1, 1, 2, 2]), (2, [1, 2, 1, 1, 1, 1, 1])]:
            api.post(f"/api/clients/{a}/assessments", json={"kind": "GAD-7", "answers": answers,
                     "taken_at": iso(now - timedelta(weeks=weeks, hours=2))}, headers=h)
        api.post(f"/api/clients/{a}/assessments", json={"kind": "PHQ-9", "answers": [1, 1, 2, 2, 1, 1, 1, 0, 0],
                 "taken_at": iso(now - timedelta(weeks=6, hours=2))}, headers=h)
        api.post(f"/api/clients/{a}/goals", json={"description": "Sleep at least 7 hours on weeknights"}, headers=h)
        g = api.post(f"/api/clients/{a}/goals", json={"description": "Use box breathing when panic starts in an exam"}, headers=h).json()["id"]
        api.patch(f"/api/goals/{g}", json={"progress": 60}, headers=h)
        session(a, now - timedelta(weeks=4, hours=2), mood_rating=4,
                data="Client reported panic symptoms (racing heart, tight chest) in two mock exams this month and sleeping about 5 hours a night. Presented tense, spoke quickly.",
                assessment="Anticipatory anxiety strongly linked to fear of failing in front of family. Engaged well and motivated.",
                plan="Introduce breathing skills and a sleep routine. Review in two weeks.",
                interventions="Psychoeducation on the panic cycle; box breathing practice in session.",
                homework="Box breathing twice daily; no phone after 11pm.",
                risk_check="Client denied thoughts of self-harm or suicide.")
        session(a, now - timedelta(weeks=2, hours=2), mood_rating=6,
                data="Client reported practising breathing most days and one mock exam without panic. Sleep improved to about 6.5 hours.",
                assessment="Good uptake of skills; anxiety reducing. Still catastrophises about results.",
                plan="Begin cognitive work on catastrophic predictions about results.",
                interventions="Reviewed homework; thought record introduced.",
                homework="One thought record each time she worries about results.",
                risk_check="No risk reported.")
        later_today = now.replace(hour=16, minute=0) if now.hour < 15 else (now + timedelta(days=1)).replace(hour=10, minute=0)
        session(a, later_today)
        # She filled in today's GAD-7 herself from a check-in link.
        token = api.post(f"/api/clients/{a}/checkins", json={"kinds": ["GAD-7"]}, headers=h).json()["token"]
        api.post(f"/api/public/checkins/{token}", json={
            "answers": {"GAD-7": [1, 1, 1, 0, 1, 1, 0]}, "mood": 7,
            "message": "Had my first real exam on Monday and used the breathing. Still worried about results day.",
        })

        # 2. Grief, with a flagged questionnaire and medium risk
        b = client(
            full_name="Brian Kiprotich Mutai", preferred_name="Brian", date_of_birth="1988-09-30",
            phone="0722 000 222", presenting_concern="Low mood and withdrawal since his father died in June.",
            background="Works in logistics, married with two children. Close to his father, who died after a short illness.",
            consent_signed=True, consent_ai=True, risk_level="medium",
            risk_notes="Passive thoughts of not wanting to wake up, no plan or intent. Safety plan agreed: call his wife Mercy or his brother; Befrienders Kenya number saved in his phone. Review every session.",
        )
        api.post(f"/api/clients/{b}/assessments", json={"kind": "PHQ-9", "answers": [2, 3, 2, 2, 1, 2, 2, 1, 1],
                 "taken_at": iso(now - timedelta(days=3))}, headers=h)
        api.post(f"/api/clients/{b}/goals", json={"description": "Return to Sunday football with friends"}, headers=h)
        session(b, now - timedelta(days=3), mood_rating=3,
                data="Client reported low mood most days, poor sleep and avoiding friends. Tearful when speaking about his father.",
                assessment="Grief reaction with significant low mood. Some passive thoughts of death; protective factors strong (children, wife, faith).",
                plan="Weekly sessions. Review safety plan next session. Consider GP referral if sleep doesn't improve.",
                interventions="Grief psychoeducation; safety planning.",
                homework="Write a short letter to his father; one walk with a friend this week.",
                risk_check="Passive thoughts of not wanting to wake up. Denied plan or intent. Safety plan completed.")
        session(b, now + timedelta(days=2, hours=1))

        # 3. New client, intake only, note still in draft
        c = client(full_name="Zawadi Njeri Kamau", phone="0733 000 333",
                   presenting_concern="Conflict with her mother and feeling stuck at work.",
                   consent_signed=True, consent_ai=False)
        session(c, now - timedelta(days=1), _sign=False, mood_rating=5,
                data="Intake session. Client described frequent arguments with her mother, with whom she lives.")

    print(f"Demo data created. Sign in with {EMAIL} / {PASSWORD}")


if __name__ == "__main__":
    main()
