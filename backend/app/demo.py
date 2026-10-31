"""A fictional demo organization for investor and partner walkthroughs.

Everything here is synthetic. The demo rebuilds itself when it is more than a day old, so
visitors can click around freely without leaving a mess for the next person.
"""

import random
import secrets
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from .config import local_now
from .measures import score
from .models import (
    Addendum,
    Assessment,
    AuditLog,
    CheckinLink,
    Client,
    CounselingSession,
    Goal,
    GroupAttendance,
    GroupSession,
    Invite,
    Letter,
    Organization,
    Programme,
    Referral,
    Therapist,
)
from .security import hash_password

DEMO_NAME = "Tumaini Youth Wellbeing Trust (demo)"
DEMO_MAX_AGE = timedelta(hours=24)

STAFF = [
    # key, name, role, title, supervisor key
    ("director", "Wanjiru Mwangi", "owner", "Programme Director", None),
    ("supervisor", "Dr Achieng Oduor", "supervisor", "Clinical Supervisor, Counselling Psychologist", None),
    ("counsellor", "Brian Kiptoo", "counsellor", "Counsellor", "supervisor"),
    ("counsellor2", "Fatuma Hassan", "counsellor", "Counsellor", "supervisor"),
    ("lay", "Joseph Otieno", "lay_counsellor", "Lay Counsellor", "supervisor"),
    ("lay2", "Mercy Njeri", "lay_counsellor", "Lay Counsellor", "supervisor"),
    ("me", "Daniel Mutua", "me_officer", "Monitoring & Evaluation Officer", None),
]
DEMO_ROLES = {"director": "director", "supervisor": "supervisor", "counsellor": "counsellor", "lay": "lay", "me": "me"}

FIRST_F = ["Akinyi", "Wambui", "Chebet", "Nafula", "Achieng", "Muthoni", "Halima", "Njeri", "Atieno", "Jepkoech",
           "Wanjiku", "Zawadi", "Amina", "Nyambura", "Awino", "Kerubo", "Makena", "Imani"]
FIRST_M = ["Otieno", "Kamau", "Kiprono", "Wafula", "Mwangi", "Omondi", "Barasa", "Kipchoge", "Mutua", "Juma",
           "Onyango", "Njoroge", "Ochieng", "Kibet", "Hassan", "Musa", "Baraka", "Tumaini"]
SURNAMES = ["Odhiambo", "Kariuki", "Wekesa", "Cheruiyot", "Ndungu", "Okoth", "Mutiso", "Simiyu", "Kilonzo",
            "Owino", "Gitau", "Rotich", "Ali", "Makori", "Njuguna", "Achola", "Langat", "Muriuki"]

SCHOOL_CONCERNS = [
    "Exam stress and difficulty sleeping before tests.", "Low mood since parents separated.",
    "Being bullied at school and avoiding class.", "Grief after the death of a grandmother.",
    "Anger outbursts at home and in class.", "Worry about family finances and school fees.",
    "Withdrawn from friends; teacher concerned.",
]
COMMUNITY_CONCERNS = [
    "Low mood and poor sleep after losing her job.", "Survivor of intimate partner violence, now living with her sister.",
    "Grief after the death of a child.", "Anxiety and panic attacks since a road accident.",
    "Caring for a parent with dementia, feeling overwhelmed.", "Drinking more since moving to the city for work.",
    "Conflict with spouse and worries about the children.",
]
INTERVENTIONS = [
    "Psychoeducation on stress; slow breathing practised in session.", "Behavioural activation: planned two enjoyable activities.",
    "Problem-solving steps applied to the school-fees worry.", "Grounding skills; validated grief responses.",
    "Thought record introduced for worry thoughts.", "Safety planning and review of support network.",
]
HOMEWORK = ["Breathing practice twice a day.", "One activity with a friend this week.", "Keep a short worry diary.",
            "Sleep routine: phone away by 10pm.", "Talk to a trusted teacher about the bullying."]
LAY_DRAFTS = [
    "Client said the week was hard. Cried when talking about home. Practised breathing together. She agreed to talk to the school matron.",
    "Client came late, said he skipped breakfast. Talked about worries for the exams. We made a study timetable together.",
    "Client shared that her uncle shouts at her mother. She feels scared at night. She denied anyone hurting her. Agreed to meet again Thursday.",
]


def _answers(kind: str, total: int, rng: random.Random, item9: int = 0) -> list[int]:
    """Spread a target total across items so the questionnaire scores exactly."""
    n = {"PHQ-9": 9, "GAD-7": 7, "WHO-5": 5}[kind]
    top = 5 if kind == "WHO-5" else 3
    raw = total // 4 if kind == "WHO-5" else total
    ans = [0] * n
    if kind == "PHQ-9":
        ans[8] = item9
        raw -= item9
    slots = [i for i in range(n) if not (kind == "PHQ-9" and i == 8)]
    while raw > 0:
        i = rng.choice(slots)
        if ans[i] < top:
            ans[i] += 1
            raw -= 1
    return ans


def reset_demo(db: Session) -> None:
    for org in db.scalars(select(Organization).where(Organization.is_demo.is_(True))).all():
        oid = org.id
        client_ids = select(Client.id).where(Client.organization_id == oid)
        session_ids = select(CounselingSession.id).where(CounselingSession.client_id.in_(client_ids))
        group_ids = select(GroupSession.id).where(GroupSession.organization_id == oid)
        db.execute(delete(GroupAttendance).where(GroupAttendance.group_id.in_(group_ids)))
        db.execute(delete(GroupSession).where(GroupSession.organization_id == oid))
        db.execute(delete(Referral).where(Referral.organization_id == oid))
        db.execute(delete(Letter).where(Letter.client_id.in_(client_ids)))
        db.execute(delete(CheckinLink).where(CheckinLink.client_id.in_(client_ids)))
        db.execute(delete(Addendum).where(Addendum.session_id.in_(session_ids)))
        db.execute(delete(CounselingSession).where(CounselingSession.client_id.in_(client_ids)))
        db.execute(delete(Assessment).where(Assessment.client_id.in_(client_ids)))
        db.execute(delete(Goal).where(Goal.client_id.in_(client_ids)))
        db.execute(delete(Invite).where(Invite.organization_id == oid))
        db.execute(delete(AuditLog).where(AuditLog.organization_id == oid))
        db.execute(delete(Client).where(Client.organization_id == oid))
        db.execute(update(Therapist).where(Therapist.organization_id == oid).values(supervisor_id=None))
        staff_ids = select(Therapist.id).where(Therapist.organization_id == oid)
        db.execute(delete(AuditLog).where(AuditLog.therapist_id.in_(staff_ids)))
        db.execute(delete(Therapist).where(Therapist.organization_id == oid))
        db.execute(delete(Programme).where(Programme.organization_id == oid))
        db.delete(org)
    db.commit()


def ensure_demo(db: Session) -> Organization:
    org = db.scalar(select(Organization).where(Organization.is_demo.is_(True)))
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    if org is not None and now_utc - org.created_at < DEMO_MAX_AGE:
        return org
    reset_demo(db)
    return seed_demo(db)


def demo_user(db: Session, key: str) -> Therapist | None:
    org = ensure_demo(db)
    email = f"{key}@tumaini.example.org"
    return db.scalar(select(Therapist).where(Therapist.organization_id == org.id, Therapist.email == email))


def seed_demo(db: Session) -> Organization:  # noqa: C901 (a long but linear script)
    rng = random.Random(20261031)
    now = local_now().replace(second=0, microsecond=0)
    today = now.date()

    org = Organization(name=DEMO_NAME, kind="ngo", country="KE", review_all_notes=False, is_demo=True)
    db.add(org)
    db.flush()

    schools = Programme(organization_id=org.id, name="Schools Wellbeing Programme", location="Nairobi (Kibera & Mathare)",
                        funder="Example Foundation")
    community = Programme(organization_id=org.id, name="Community Psychosocial Support", location="Kisumu County",
                          funder="Example Health Fund")
    db.add_all([schools, community])
    db.flush()

    staff: dict[str, Therapist] = {}
    pw = hash_password(secrets.token_urlsafe(24))  # nobody signs in with a password; demo login issues a token
    for key, name, role, title, _ in STAFF:
        t = Therapist(organization_id=org.id, role=role, name=name, title=title, email=f"{key}@tumaini.example.org",
                      password_hash=pw, practice_name=org.name, phone="0700 000 000",
                      address="Example House, Ngong Road\nNairobi", license_no="DEMO-REG" if role != "me_officer" else None)
        db.add(t)
        staff[key] = t
    db.flush()
    for key, *_rest, sup in STAFF:
        if sup:
            staff[key].supervisor_id = staff[sup].id
    db.flush()

    used: set[str] = set()

    def person(female: bool) -> str:
        while True:
            n = f"{rng.choice(FIRST_F if female else FIRST_M)} {rng.choice(SURNAMES)}"
            if n not in used:
                used.add(n)
                return n

    counsellors = {"schools": ["counsellor", "lay", "lay2"], "community": ["counsellor2", "counsellor", "lay"]}
    clients: list[tuple[Client, str]] = []
    for prog_key, prog, n, ages, locs, concerns in (
        ("schools", schools, 26, (11, 18), ["Kibera", "Mathare"], SCHOOL_CONCERNS),
        ("community", community, 20, (19, 52), ["Kisumu Central", "Nyalenda", "Manyatta", "Obunga"], COMMUNITY_CONCERNS),
    ):
        for i in range(n):
            female = rng.random() < (0.55 if prog_key == "schools" else 0.72)
            age = rng.randint(*ages)
            dob = date(today.year - age, rng.randint(1, 12), rng.randint(1, 28))
            name = person(female)
            minor = age < 18
            c = Client(
                organization_id=org.id, programme_id=prog.id, therapist_id=staff[rng.choice(counsellors[prog_key])].id,
                full_name=name, preferred_name=name.split()[0], date_of_birth=dob,
                gender="female" if female else ("male" if rng.random() > 0.04 else "undisclosed"),
                location=rng.choice(locs), phone=f"07{rng.randint(10, 99)} 000 {rng.randint(100, 999)}",
                referral_source=rng.choice(["teacher", "self", "community health volunteer", "parent", "health facility"]),
                presenting_concern=rng.choice(concerns), consent_signed=True, consent_ai=rng.random() < 0.7,
                guardian_name=f"{rng.choice(FIRST_F)} {name.split()[1]}" if minor else None,
                guardian_phone="0711 000 000" if minor else None, guardian_consent=minor,
                created_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=rng.randint(20, 130)),
            )
            db.add(c)
            clients.append((c, prog_key))
    db.flush()

    # Risk, restriction and an escalation
    for c, _ in rng.sample(clients, 6):
        c.risk_level = "medium"
        c.risk_notes = "Passive thoughts of death at intake, no plan or intent. Safety plan agreed; review each session."
    gbv = next(c for c, p in clients if p == "community" and "violence" in (c.presenting_concern or ""))
    gbv.risk_level, gbv.restricted = "high", True
    gbv.risk_notes = "GBV survivor. Restricted case: do not contact via the shared family phone. Safe number on file."
    lay_client = next(c for c, p in clients if c.therapist_id == staff["lay"].id and p == "schools")
    lay_client.escalated_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=20)
    lay_client.escalation_note = "Student mentioned not wanting to wake up some mornings. Denied a plan. I'd like Dr Achieng to see her this week."
    lay_client.escalated_by_id = staff["lay"].id
    lay_client.risk_level = "medium"
    lay_client.risk_notes = "Mentioned not wanting to wake up some mornings; denied plan or intent. Class teacher and guardian aware. Supervisor to review this week."
    db.flush()
    db.add(AuditLog(organization_id=org.id, therapist_id=staff["lay"].id, action="escalate", entity="client",
                    entity_id=lay_client.id, at=lay_client.escalated_at))

    extra = random.Random(2026)
    for c, prog_key in clients:
        c.preferred_language = "Kiswahili" if prog_key == "schools" else extra.choice(["Dholuo", "Kiswahili", "English"])

    # Individual sessions over the last ~4 months, with improving questionnaire scores for most people
    review_left = 3
    for c, prog_key in clients:
        start_days = rng.randint(28, 120)
        n_sessions = rng.randint(2, 7)
        improving = rng.random() < 0.72
        base_phq = rng.randint(9, 19)
        base_gad = rng.randint(8, 17)
        base_who = rng.choice([24, 28, 32, 36, 40, 44])
        author = db.get(Therapist, c.therapist_id)
        for k in range(n_sessions):
            when = datetime.combine(today - timedelta(days=start_days - k * rng.randint(10, 16)), datetime.min.time()).replace(
                hour=rng.choice([9, 10, 11, 14, 15]))
            if when.date() > today:
                break
            st = "no_show" if rng.random() < 0.08 else "attended"
            s = CounselingSession(therapist_id=c.therapist_id, client_id=c.id, scheduled_at=when, duration_min=50, status=st)
            # A separate random stream, so adding these details doesn't change the demo's other figures
            s.setting = "school" if prog_key == "schools" else extra.choice(["facility", "home_visit", "outreach", "outreach"])
            s.language = extra.choice(["Kiswahili", "English", "Sheng", "Kiswahili"] if prog_key == "schools"
                                      else ["Dholuo", "Kiswahili", "Kiswahili", "English"])
            if st == "attended":
                progress = k / max(1, n_sessions - 1)
                s.mood_rating = max(1, min(10, 3 + round(progress * 4 if improving else rng.randint(-1, 1)) + rng.randint(0, 1)))
                s.data = f"Client attended. Reported: {c.presenting_concern.lower()} Mood {s.mood_rating}/10."
                s.assessment = ("Engaged well; some improvement since last session." if improving and k
                                else "Distress remains significant; building rapport.")
                s.plan = "Continue fortnightly sessions; review homework next time."
                s.interventions = rng.choice(INTERVENTIONS)
                s.homework = rng.choice(HOMEWORK)
                s.risk_check = "Client denied thoughts of self-harm or suicide." if c.risk_level == "none" else c.risk_notes
                s.note_status = "signed"
                s.signed_at = (when + timedelta(hours=rng.choice([2, 5, 20, 30, 70]))).replace(tzinfo=None) - timedelta(hours=3)
                if author.role == "lay_counsellor":
                    s.review_status = "approved"
                    s.reviewed_by_id = staff["supervisor"].id
                    s.reviewed_at = s.signed_at + timedelta(hours=10)
                    if k == n_sessions - 1 and review_left and (today - when.date()).days < 14:
                        s.note_status, s.review_status = "submitted", "pending"
                        s.reviewed_by_id = s.reviewed_at = None
                        s.data = LAY_DRAFTS[review_left - 1]
                        review_left -= 1
            db.add(s)

            if st == "attended" and k in (0, n_sessions - 1, n_sessions // 2):
                drop = (k / max(1, n_sessions - 1)) * (rng.randint(5, 10) if improving else rng.randint(-2, 3))
                phq = max(1, min(26, round(base_phq - drop)))
                gad = max(1, min(20, round(base_gad - drop * 0.8)))
                item9 = 1 if (c.risk_level != "none" and k == 0) else 0
                for kind, total in (("PHQ-9", max(phq, item9)), ("GAD-7", gad)):
                    ans = _answers(kind, total, rng, item9 if kind == "PHQ-9" else 0)
                    r = score(kind, ans)
                    db.add(Assessment(therapist_id=c.therapist_id, client_id=c.id, kind=kind, answers=ans,
                                      total=r["total"], severity=r["severity"], flags=r["flags"],
                                      taken_at=when - timedelta(minutes=10)))
                if prog_key == "schools":
                    who = max(8, min(92, round((base_who + drop * 4) / 4) * 4))
                    ans = _answers("WHO-5", who, rng)
                    r = score("WHO-5", ans)
                    db.add(Assessment(therapist_id=c.therapist_id, client_id=c.id, kind="WHO-5", answers=ans,
                                      total=r["total"], severity=r["severity"], flags=r["flags"],
                                      taken_at=when - timedelta(minutes=5)))
        # A scheduled session ahead for active clients
        if rng.random() < 0.6:
            ahead = now + timedelta(days=rng.randint(1, 6))
            ahead = ahead.replace(hour=rng.choice([9, 11, 14, 16]), minute=0)
            db.add(CounselingSession(therapist_id=c.therapist_id, client_id=c.id, scheduled_at=ahead, duration_min=50))
        if rng.random() < 0.5:
            db.add(Goal(therapist_id=c.therapist_id, client_id=c.id,
                        description=rng.choice(
                            ["Sleep at least 7 hours on school nights", "Attend every class this term",
                             "Use breathing skills before exams", "Talk to one trusted adult each week"]
                            if prog_key == "schools" else
                            ["Rejoin the women's chama meetings", "Use breathing skills when panic starts",
                             "Sleep at least 6 hours most nights", "Plan one enjoyable activity each week"]),
                        progress=rng.choice([20, 40, 60, 80])))

    # A note returned to a lay counsellor with feedback
    db.flush()
    lay2_client = next(c for c, _ in clients if c.therapist_id == staff["lay2"].id)
    db.add(CounselingSession(
        therapist_id=staff["lay2"].id, client_id=lay2_client.id, scheduled_at=now - timedelta(days=2, hours=3),
        status="attended", mood_rating=4, data="Talked about home. Practised breathing.",
        note_status="draft", review_status="returned", reviewed_by_id=staff["supervisor"].id,
        reviewed_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=26),
        review_comment="Good session. Please add the risk check (ask directly about self-harm) and what you agreed for next week.",
    ))

    # Group sessions with registers
    school_members = [c for c, p in clients if p == "schools"]
    community_members = [c for c, p in clients if p == "community" and c.gender == "female" and not c.restricted]
    for weeks_ago in range(10, -1, -1):
        held = datetime.combine(today - timedelta(days=weeks_ago * 7 + 2), datetime.min.time()).replace(hour=14)
        if held > now:
            continue
        g = GroupSession(organization_id=org.id, programme_id=schools.id, facilitator_id=staff["lay"].id,
                         title="Form 2 wellbeing circle", topic=rng.choice(["Coping with exam stress", "Friendship and bullying",
                                                                             "Sleep and study", "Handling anger", "Grief and loss"]),
                         location="Kibera Secondary (demo)", held_at=held, duration_min=60, status="held",
                         notes="Group engaged well. Two students stayed back to talk; followed up individually.")
        db.add(g)
        db.flush()
        for c in rng.sample(school_members, rng.randint(9, 14)):
            db.add(GroupAttendance(group_id=g.id, client_id=c.id, present=rng.random() > 0.12))
        if weeks_ago % 2 == 0:
            g2 = GroupSession(organization_id=org.id, programme_id=community.id, facilitator_id=staff["counsellor2"].id,
                              title="Women's support circle", topic=rng.choice(["Safety and support networks", "Stress and the body",
                                                                                 "Rebuilding routines", "Money worries"]),
                              location="Nyalenda community hall", held_at=held + timedelta(days=1), duration_min=90,
                              status="held", notes="Psychoeducation and sharing. Tea provided.")
            db.add(g2)
            db.flush()
            for c in rng.sample(community_members, min(len(community_members), rng.randint(6, 9))):
                db.add(GroupAttendance(group_id=g2.id, client_id=c.id, present=rng.random() > 0.15))

    # Referrals with outcomes
    services = [("medical", "Kibera Health Centre (demo)"), ("psychiatric", "County Referral Hospital, psychiatry clinic"),
                ("legal", "Example Legal Aid Clinic"), ("gbv", "County GBV Recovery Centre"),
                ("protection", "Sub-County Children's Office"), ("economic", "Women's savings group"),
                ("education", "School bursary committee")]
    for c, _ in rng.sample(clients, 14):
        svc, to = rng.choice(services)
        made = today - timedelta(days=rng.randint(3, 100))
        status = rng.choices(["attended", "attended", "attended", "made", "accepted", "not_attended", "declined"])[0]
        db.add(Referral(organization_id=org.id, client_id=c.id, created_by_id=c.therapist_id, service=svc, to_organisation=to,
                        reason="Needs specialist support alongside counselling.", urgency=rng.choice(["routine", "routine", "urgent"]),
                        status=status, referred_on=made, follow_up_on=made + timedelta(days=14),
                        outcome="Attended first appointment; feedback received." if status == "attended" else None))
    db.add(Referral(organization_id=org.id, client_id=gbv.id, created_by_id=gbv.therapist_id, service="gbv",
                    to_organisation="County GBV Recovery Centre", reason="Medical and legal follow-up after assault.",
                    urgency="urgent", status="attended", referred_on=today - timedelta(days=40),
                    follow_up_on=today - timedelta(days=37), outcome="Seen same week. P3 form completed."))

    # Two recent client check-ins with messages
    for c, msg, mood in ((school_members[0], "The breathing helped before my maths exam. Still scared about results.", 6),
                         (community_members[0], "This week was better. I went back to the chama meeting.", 7)):
        ans = _answers("PHQ-9", 6, rng)
        r = score("PHQ-9", ans)
        db.add(Assessment(therapist_id=c.therapist_id, client_id=c.id, kind="PHQ-9", answers=ans, total=r["total"],
                          severity=r["severity"], flags=r["flags"], source="client", taken_at=now - timedelta(days=1)))
        db.add(CheckinLink(therapist_id=c.therapist_id, client_id=c.id, token_hash=secrets.token_hex(32), kinds=["PHQ-9"],
                           expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=2),
                           completed_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=20),
                           mood=mood, message=msg))
    db.commit()
    return org
