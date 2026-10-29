# Kumbuka

Session notes for counselors. *Kumbuka* is Swahili for "remember".

A counselor speaks or types rough notes after a session, and Kumbuka turns them into a structured DAP note. It keeps each client's history, scores, goals and letters in one place, and prepares a short brief before the next session.

**Stack:** React + TypeScript (Vite, Tailwind) on **Netlify** · FastAPI + SQLAlchemy + Alembic on **Render** · Postgres (**Supabase**) · Claude API (optional)

## Features

**Clients and notes**
- Client profile, presenting concern, background, emergency contact, consent (with separate consent for AI-assisted notes), risk level and safety plan.
- DAP session notes: dictate in the browser, then **Draft the note** turns rough notes into Data, Assessment, Plan, interventions, homework and a risk check.
- **Signing** locks a note. Corrections become dated addenda. Private reflections are never exported or sent to AI.
- Goals with progress; PHQ-9 and GAD-7 with auto-scoring, severity bands, trend charts and a flag when PHQ-9 item 9 is endorsed.
- Overview / pre-session brief, Today screen, activity log, and a "download record" export for access requests.

**Client check-in links**
- From a client's Questionnaires tab, **Send a check-in link**. Kumbuka writes a short, neutral message (it doesn't mention counseling) for WhatsApp, SMS or copying.
- The client opens the link on their phone. It asks for their mood (1–10), a PHQ-9 and/or GAD-7, and an optional message to the counselor. No sign-in is needed.
- Links work once and expire (1, 3 or 7 days). Only a hash of each link is stored.
- Scores land in the client's record, marked "by client". The message shows on the client overview, and new check-ins show on the Today screen.
- If the client endorses PHQ-9 item 9, the thank-you page shows Kenyan support lines: 999/112, Kenya Red Cross 1199, and Befrienders Kenya +254 722 178 177. They're in `frontend/src/pages/CheckIn.tsx`; recheck the numbers from time to time.

**Printing and letters**
- Practice letterhead (practice name, title, registration number, address) in **Settings**.
- **Print or save as PDF**: signed session notes, a client summary (attendance, goals, score chart and table, risk), and letters.
- Letters tab: confirmation of attendance (dates filled in automatically, content not disclosed), referral (optionally drafted by AI from signed notes; the client's name is never sent to AI), and blank letters. Letters are saved per client and included in the record export.
- Prints are recorded in the activity log.

**Security**
- Two-step sign-in with any authenticator app, plus 8 one-time recovery codes. Each code works only once, and the secret is encrypted at rest.
- An account locks for 15 minutes after 5 wrong attempts. Sign-in attempts are also rate-limited per network, and failed and locked sign-ins are logged.
- **Auto-lock** after 15 minutes without activity (`IDLE_LOCK_MINUTES`). A one-minute warning appears, and open drafts are saved first.
- **Sign out everywhere**. Changing the password also signs out other devices.
- Only the first account can register by default (`ALLOW_REGISTRATION=first`), so a public URL can't be used to sign up.
- Every query is scoped to the signed-in counselor. Security headers and a strict Content-Security-Policy are set, and API docs are hidden in production.
- The app refuses to start in production with SQLite or a weak `SECRET_KEY`.

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
2. If your Render URL isn't `https://kumbuka-api.onrender.com`, edit **both** `VITE_API_URL` and the `connect-src` entry in `netlify.toml`, then push.
3. Put the Netlify URL into Render's `CORS_ORIGINS` (Render, then Environment). Render redeploys by itself.

**4. First sign-in**

Open the Netlify URL and create the account. That's the practice owner, and sign-ups close after it. Then go to Settings, add the practice details and turn on two-step sign-in.

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

The demo login (after `seed_demo.py`) is `demo@example.com` / `demo-password`. API docs are at http://localhost:8000/docs.

**Tests:** `cd backend && pytest` (SQLite). To run against Postgres, use `TEST_DATABASE_URL=postgresql://... pytest`.

**Schema changes:** edit `app/models.py`, run `alembic revision --autogenerate -m "what changed"`, and commit the new file in `migrations/versions/`. It applies automatically on the next deploy.

## AI

AI turns on with `ANTHROPIC_API_KEY`. It is used only for clients with AI consent, and only clinical text is sent: never names, phone numbers, emails or dates of birth. Everything AI writes is a draft the counselor reviews.

Without a key, the app works fully:
- **Draft the note** copies your notes into Data and runs a keyword check for risk mentions.
- Briefs show facts without a written summary.
- Referral letters use a template.

## Before real client data goes in

- [ ] Strong `SECRET_KEY` (Render generates one). Don't change it later: it also encrypts two-step sign-in secrets.
- [ ] Supabase backups on, and the project region chosen deliberately.
- [ ] Two-step sign-in turned on for the counselor account.
- [ ] Kenya Data Protection Act: register with the ODPC and complete a Data Protection Impact Assessment. Health data is sensitive personal data.
- [ ] Mention AI-assisted notes and check-in links in the client consent form.
- [ ] Browser dictation uses the browser's speech service (in Chrome, Google's). If that's not acceptable, type notes instead.

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
    ai.py              note drafting, briefs, referral letters (with fallbacks)
    routers/           auth, clients, sessions, measures, dashboard, checkins, letters
  migrations/          Alembic
  tests/               pytest (SQLite or Postgres)
frontend/src/
  pages/               Today, Clients, ClientPage, SessionNote, Settings, CheckIn (public), LetterEditor, PrintPages, Activity, Login
  components/          Layout, Print, ClientForm, client/ tabs (Overview, Sessions, Measures + CheckinPanel, Goals, Letters)
```
