"""field identifiers, session language and setting, offline sync log

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-01 02:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("clients") as b:
        b.add_column(sa.Column("unhcr_case_no", sa.String(length=40), nullable=True))
        b.add_column(sa.Column("primero_case_id", sa.String(length=60), nullable=True))
        b.add_column(sa.Column("settlement", sa.String(length=120), nullable=True))
        b.add_column(sa.Column("block", sa.String(length=60), nullable=True))
        b.add_column(sa.Column("preferred_language", sa.String(length=40), nullable=True))
        b.add_column(sa.Column("interpreter_needed", sa.Boolean(), server_default="false", nullable=False))
    with op.batch_alter_table("sessions") as b:
        b.add_column(sa.Column("setting", sa.String(length=20), nullable=True))
        b.add_column(sa.Column("language", sa.String(length=40), nullable=True))
        b.add_column(sa.Column("interpreter_used", sa.Boolean(), server_default="false", nullable=False))
    op.create_table(
        "field_sync",
        sa.Column("offline_id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=True),
        sa.Column("therapist_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("object_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], name="fk_field_sync_organization"),
        sa.ForeignKeyConstraint(["therapist_id"], ["therapists.id"], name="fk_field_sync_therapist"),
        sa.PrimaryKeyConstraint("offline_id"),
    )
    op.create_index("ix_field_sync_organization_id", "field_sync", ["organization_id"])
    op.create_index("ix_field_sync_therapist_id", "field_sync", ["therapist_id"])


def downgrade() -> None:
    op.drop_index("ix_field_sync_therapist_id", table_name="field_sync")
    op.drop_index("ix_field_sync_organization_id", table_name="field_sync")
    op.drop_table("field_sync")
    with op.batch_alter_table("sessions") as b:
        b.drop_column("interpreter_used")
        b.drop_column("language")
        b.drop_column("setting")
    with op.batch_alter_table("clients") as b:
        for c in ("interpreter_needed", "preferred_language", "block", "settlement", "primero_case_id", "unhcr_case_no"):
            b.drop_column(c)
