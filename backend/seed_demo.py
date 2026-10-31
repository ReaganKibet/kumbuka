"""Create (or refresh) the fictional demo organization in the database from DATABASE_URL.

    python seed_demo.py

Then sign in from the landing page with "Explore the demo" (set DEMO_ENABLED=true), or use the
API: POST /api/auth/demo {"role": "director" | "supervisor" | "counsellor" | "lay" | "me"}.
Never point this at a database you don't want a demo organization in.
"""

from app.db import SessionLocal, run_migrations
from app.demo import reset_demo, seed_demo

if __name__ == "__main__":
    run_migrations()
    with SessionLocal() as db:
        reset_demo(db)
        org = seed_demo(db)
        print(f"Demo organization ready: {org.name} (id {org.id})")
