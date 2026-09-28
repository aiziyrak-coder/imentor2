"""O'qituvchi o'zi yuklagan kitob/protokol: core_subjectbook.owner_key, status, status_note

Revision ID: u1v2w3x4y5z6
Revises: t0u1v2w3x4y5
Create Date: 2026-09-24
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "u1v2w3x4y5z6"
down_revision: Union[str, None] = "t0u1v2w3x4y5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("core_subjectbook", sa.Column("owner_key", sa.String(length=128), nullable=False, server_default=""))
    op.add_column("core_subjectbook", sa.Column("status", sa.String(length=16), nullable=False, server_default="ready"))
    op.add_column("core_subjectbook", sa.Column("status_note", sa.String(length=255), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("core_subjectbook", "status_note")
    op.drop_column("core_subjectbook", "status")
    op.drop_column("core_subjectbook", "owner_key")
