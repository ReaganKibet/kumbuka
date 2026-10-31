from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import local_now
from ..db import get_db
from ..measures import MeasureError, public_definitions, score
from ..models import Assessment, Goal, Therapist
from ..schemas import AssessmentIn, AssessmentOut, GoalIn, GoalOut, GoalUpdate
from ..security import audit, clinical_only, current_therapist, owned_client

router = APIRouter(tags=["measures & goals"])


@router.get("/measures")
def measure_definitions(_: Therapist = Depends(current_therapist)):
    return public_definitions()


@router.get("/clients/{client_id}/assessments", response_model=list[AssessmentOut])
def list_assessments(client_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    client = owned_client(db, client_id, me)
    return db.scalars(
        select(Assessment).where(Assessment.client_id == client.id).order_by(Assessment.taken_at)
    ).all()


@router.post("/clients/{client_id}/assessments", response_model=AssessmentOut, status_code=201)
def add_assessment(
    client_id: int, body: AssessmentIn, db: Session = Depends(get_db), me: Therapist = Depends(clinical_only)
):
    client = owned_client(db, client_id, me)
    try:
        result = score(body.kind, body.answers)
    except MeasureError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(e))
    a = Assessment(
        therapist_id=me.id,
        client_id=client.id,
        kind=body.kind,
        answers=body.answers,
        total=result["total"],
        severity=result["severity"],
        flags=result["flags"],
        taken_at=(body.taken_at or local_now()).replace(tzinfo=None),
    )
    db.add(a)
    db.flush()
    audit(db, me, "create", "assessment", a.id, body.kind)
    db.commit()
    return a


@router.delete("/assessments/{assessment_id}", status_code=204)
def delete_assessment(assessment_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    a = db.get(Assessment, assessment_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assessment not found")
    owned_client(db, a.client_id, me)
    audit(db, me, "delete", "assessment", a.id)
    db.delete(a)
    db.commit()


@router.get("/clients/{client_id}/goals", response_model=list[GoalOut])
def list_goals(client_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    client = owned_client(db, client_id, me)
    return db.scalars(select(Goal).where(Goal.client_id == client.id).order_by(Goal.created_at)).all()


@router.post("/clients/{client_id}/goals", response_model=GoalOut, status_code=201)
def add_goal(client_id: int, body: GoalIn, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    client = owned_client(db, client_id, me)
    g = Goal(therapist_id=me.id, client_id=client.id, description=body.description.strip())
    db.add(g)
    db.flush()
    audit(db, me, "create", "goal", g.id)
    db.commit()
    return g


def _owned_goal(db: Session, goal_id: int, me: Therapist) -> Goal:
    g = db.get(Goal, goal_id)
    if g is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Goal not found")
    owned_client(db, g.client_id, me)
    return g


@router.patch("/goals/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: int, body: GoalUpdate, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    g = _owned_goal(db, goal_id, me)
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(g, k, v)
    if changes.get("status") == "achieved" and "progress" not in changes:
        g.progress = 100
    audit(db, me, "update", "goal", g.id)
    db.commit()
    return g


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, db: Session = Depends(get_db), me: Therapist = Depends(current_therapist)):
    g = _owned_goal(db, goal_id, me)
    audit(db, me, "delete", "goal", g.id)
    db.delete(g)
    db.commit()
