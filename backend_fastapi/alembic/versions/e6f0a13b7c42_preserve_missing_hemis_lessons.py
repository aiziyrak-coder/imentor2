"""Preserve HEMIS lessons missing from a later snapshot."""
from alembic import op
import sqlalchemy as sa

revision = "e6f0a13b7c42"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("core_hemislesson", sa.Column("hemis_status", sa.String(32), nullable=False, server_default="active"))
    op.add_column("core_hemislesson", sa.Column("hemis_missing_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("core_hemislesson", "hemis_missing_at")
    op.drop_column("core_hemislesson", "hemis_status")
