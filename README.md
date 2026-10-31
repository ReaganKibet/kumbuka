# Kumbuka

Counselling records, supervision and impact reporting for Africa's schools, NGOs and counselling centres. *Kumbuka* is Swahili for "remember".

**Live:** https://kumbukatherapy.netlify.app (landing page with a one-click demo).

**Stack:** React + TypeScript (Vite, Tailwind) on **Netlify** · FastAPI + SQLAlchemy + Alembic on **Render** · Postgres (**Supabase**) · Google Gemini or Claude (optional)

## Who it's for

Organisations that deliver counselling or psychosocial support at scale, often through lay counsellors under clinical supervision, and that must report outcomes to funders: NGOs, schools and universities, counselling centres, faith-based and county services. Each organisation's data is fully isolated, and all 54 African countries are supported for phone numbers and settings.

## Features

**Organisations, roles and programmes**
- Sign-up creates an organisation (NGO, school, centre, practice…) with its country. Staff join by invitation link (WhatsApp, email or copy).
- **Roles:** owner, administrator, clinical supervisor, counsellor, lay counsellor and M&E officer, each seeing only what it needs:
  - Counsellors and lay counsellors see their own clients.
  - Supervisors see their team's clients.
  - Admins see everyone except restricted cases.
  - M&E officers see anonymised reports only.
- **Programmes** (e.g. "Schools Wellbeing, Kibera", with an optional funder) group clients and group sessions, and reports can be filtered by them.
- **Caseload transfer** when someone leaves. Deactivated staff are signed out immediately.

**Supervision (task-sharing)**
- Lay counsellors' notes go to their supervisor to **co-sign** or **return with feedback**. Organisations can require this for all counsellors.
- **Escalation:** any counsellor can ask a supervisor for help with a client. It appears straight away in the supervisor's queue.
- The **Supervision page** shows notes to review, escalations, high-risk clients and each team member's caseload and late notes.

**Clients and sessions**
- Notes in DAP format, typed, dictated, or drafted by AI from a **recording of the session or a voice note** (optional, with consent). Transcripts handle English, Kiswahili and Sheng; names and phone numbers are blanked out, and audio is never stored.
- **Signing locks a note**; later corrections become addenda.
- **Private reflections** are visible only to their author, never even to supervisors.
- **Questionnaires:** PHQ-9, GAD-7 and WHO-5, with trend charts and a self-harm flag on PHQ-9 item 9.
- **Goals**, plus **letters** printed on the organisation's letterhead.
- **Minors:** guardian name, phone and consent are prompted automatically for clients under 18.
- **Restricted cases** (GBV, abuse, staff-related) can be opened only by the counsellor and their supervisor.
- **WhatsApp/SMS check-in links:** clients answer questionnaires on their phone. The organisation's own crisis lines are shown afterwards, with Kenyan defaults.

**Field work and humanitarian programmes**
- **Offline field kit** (`/field`): before going somewhere without signal, a counsellor downloads their own active clients and groups.
  - The kit is encrypted on the phone with a PIN (AES-GCM, PBKDF2), wiped after ten wrong PINs, and expires after 72 hours.
  - Offline, they can look people up, record sessions, questionnaires and group attendance, and register new people.
  - Work uploads automatically when the connection returns. Each record carries a device-made ID, so retries never duplicate anything.
  - Uploaded notes arrive as drafts to read and sign.
  - The app itself loads offline through a service worker, which never caches client data.
- **Field identifiers:** UNHCR proGres and Primero case numbers, camp or settlement and block, preferred language and interpreter needs. Sessions record where they took place, the language used and whether an interpreter was present.

**Groups and referrals**
- **Group sessions** (school wellbeing circles, support groups) with an attendance register. New members can be registered on the spot.
- **Referrals** to medical, psychiatric, legal, child protection, GBV, education or economic services. Each referral gets an automatic follow-up date based on urgency and an outcome, and overdue follow-ups are highlighted.

**Funder / M&E reports** (`/reports`, CSV export, print to PDF)
- **Reach:** people reached and new clients, one-to-one and group attendance, and the no-show rate.
- **Who was reached:** breakdowns by gender, age band (under-18s separated), location and programme.
- **Outcomes** for PHQ-9, GAD-7 and WHO-5:
  - **Improved:** a reliable change from first to latest score (PHQ-9 down 5 or more points, GAD-7 down 4 or more, WHO-5 up 10 or more).
  - **Recovered:** crossing the clinical cut-off.
  - Average scores at first and latest assessment.
- **Referral completion**, **safeguarding** counts and **record quality** (notes signed within 48 hours, notes awaiting review).
- Every figure is calculated from structured data, never by AI. Any group of 1–4 people shows as "<5", and exports are always suppressed this way.
- **UN and humanitarian indicators:** the same figures mapped to the IASC Common M&E Framework for MHPSS: O5.4 focused care by women, men, girls and boys; Gi.3 symptoms; Gi.2 wellbeing; O5.2 supervision; O5.3 referrals. Includes where sessions took place and in which languages, and appears in the CSV too.
- **Narrative for your funder:** an optional AI first draft of the write-up, made from the anonymised figures only.

**Security:** two-step sign-in and recovery codes, lockout and rate limiting, auto-lock after inactivity, sign out everywhere, per-organisation activity log (admins see everyone's actions), security headers and CSP.

**Investor / partner demo:** with `DEMO_ENABLED=true`, the landing page offers one-click entry into *Tumaini Youth Wellbeing Trust*, a fictional Kenyan NGO:
- Two programmes and seven staff.
- About 46 clients over four months, with groups, referrals, notes awaiting review and an escalation.
- Five roles to choose from: director, supervisor, counsellor, lay counsellor and M&E officer.
- It rebuilds itself every 24 hours. Demo accounts can't change passwords, set up two-step sign-in or send invitations.

## Deploy: Render (API) + Netlify (frontend) + Supabase (database)

**1. Database: Supabase**
1. Create a project (region: Frankfurt / eu-central-1 is closest to Render's Frankfurt).
2. Open **Connect**, then copy the **Session pooler** URI (port 5432). Render can't reach Supabase's direct IPv6 address, so don't use that one.
3. Replace `[YOUR-PASSWORD]` and add `?sslmode=require` at the end.

Tables are created automatically on first start.

**2. API: Render**
1. In the Render dashboard, choose **New**, then **Blueprint**, and pick this repo. It reads `render.yaml`.
2. Fill in the prompted values:
   - `DATABASE_URL`: the Supabase URI.
   - `CORS_ORIGINS`: your Netlify URL, e.g. `https://kumbuka.netlify.app`. You can set it after step 3.
   - `ANTHROPIC_API_KEY`: optional.
3. Deploy, then open `https://<your-service>.onrender.com/api/health`. It should return `{"ok": true}`.

The free plan sleeps after 15 idle minutes, so the first request after a break takes up to a minute (the login page says so). For daily practice use, switch to a paid instance.

**3. Frontend: Netlify**
1. Choose **Add new site**, then **Import an existing project**, and pick this repo. `netlify.toml` sets everything up.
2. If your Render URL isn't `https://kumbuka-api-skzu.onrender.com`, edit **both** `VITE_API_URL` and the `connect-src` entry in `netlify.toml`, then push.
3. Put the Netlify URL into Render's `CORS_ORIGINS` (Render, then Environment). Render redeploys by itself.

**4. First sign-in**

Open the Netlify URL and choose **Set up your organisation**. The person who signs up becomes the owner. Then go to Settings to add programmes and crisis lines, invite staff from **Team**, and turn on two-step sign-in. `ALLOW_REGISTRATION` controls sign-ups: `true` lets any organisation sign up (the default on Render), `first` allows only the first account, and `false` closes sign-ups.

## Run locally

You need Python 3.12+ and Node 20.19+.

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                   # set SECRET_KEY; ANTHROPIC_API_KEY optional
python seed_demo.py                                    # optional demo data
uvicorn app.main:app --reload --port 8000

# Frontend (second terminal)
cd frontend && npm install && npm run dev              # http://localhost:5173
```

For the demo, set `DEMO_ENABLED=true` in `.env` and open http://localhost:5173/welcome, or run `python seed_demo.py` to build it straight away. API docs are at http://localhost:8000/docs.

**Tests:** `cd backend && pytest` (SQLite). To run against Postgres, use `TEST_DATABASE_URL=postgresql://... pytest`.

**Schema changes:** edit `app/models.py`, run `alembic revision --autogenerate -m "what changed"`, and commit the new file in `migrations/versions/`. It applies automatically on the next deploy.

## AI

AI is optional. Everything works without it. Set **one** key on Render:

| Key | Gives you | Notes |
|---|---|---|
| `GEMINI_API_KEY` | Transcription of sessions and voice notes, note drafting, briefs, referral letters, funder narratives | Free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Default model `gemini-3.5-flash-lite` |
| `ANTHROPIC_API_KEY` | Everything except transcription | Paid |

**Free Gemini keys and real clients.** Google's terms say free-tier content may be read by human reviewers and used to improve Google's products, and ask you not to send sensitive or personal information. So on a free key Kumbuka uses AI only for:
- the fictional demo organisation (investors can try every AI feature), and
- funder narratives, which only ever see anonymised, suppressed figures.

Real organisations' client records are never sent. To use AI with real clients, turn on billing for the key in Google AI Studio (paid-tier data isn't used to train Google's models), then set `GEMINI_BILLING_ENABLED=true`. Gemini 3.5 Flash-Lite costs about US$0.30 per million input tokens; an hour of audio is about 115,000 input tokens plus the transcript (US$2.50 per million output tokens), so an hour-long session costs roughly US$0.05 to US$0.10 to transcribe.

**What is sent:**
- Typed notes, briefs and letters go without names or contact details.
- Audio is sent once for transcription and never stored. Session recordings need the client's agreement each time, which is written to the activity log.
- Every AI result is a draft the counsellor reviews.

## Before real client data goes in

- [ ] Strong `SECRET_KEY` (Render generates one). Don't change it later: it also encrypts two-step sign-in secrets.
- [ ] Supabase backups on, and the project region chosen deliberately.
- [ ] Two-step sign-in turned on for the counselor account.
- [ ] Kenya Data Protection Act: register with the ODPC and complete a Data Protection Impact Assessment. Health data is sensitive personal data.
- [ ] Mention AI-assisted notes and check-in links in the client consent form.
- [ ] Browser dictation uses the browser's speech service (in Chrome, Google's). If that's not acceptable, type notes instead.
- [ ] Before using AI with real clients: billing on for the Gemini key, `GEMINI_BILLING_ENABLED=true`, and session recording mentioned in the consent form.

## Project layout

```
render.yaml            Render blueprint (API)
netlify.toml           Netlify build, SPA routing, security headers
Dockerfile             Alternative: one container serving API + frontend
backend/
  app/
    main.py            app, CORS, security headers, migrations on start
    config.py          settings + production safety checks
    models.py          Therapist, Client, CounselingSession, Addendum, Assessment, Goal, CheckinLink, Letter, AuditLog
    security.py        passwords, tokens, two-step sign-in, lockout, rate limits, audit
    measures.py        PHQ-9 / GAD-7 scoring
    ai.py              Gemini/Claude: transcription, note drafting, briefs, letters, funder narrative (with fallbacks)
    routers/           auth, clients, sessions, measures, dashboard, checkins, letters
  migrations/          Alembic
  tests/               pytest (SQLite or Postgres)
frontend/src/
  pages/               Today, Clients, ClientPage, SessionNote, Settings, CheckIn (public), LetterEditor, PrintPages, Activity, Login
  components/          Layout, Print, ClientForm, client/ tabs (Overview, Sessions, Measures + CheckinPanel, Goals, Letters)
```
