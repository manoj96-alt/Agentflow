"""create execution_runs table

Revision ID: b2c3d4e5f6a7
Revises: 8b9a437ce279
Create Date: 2025-01-10 12:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = 'b2c3d4e5f6a7'
down_revision = '8b9a437ce279'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'execution_runs',
        sa.Column('id',           UUID(as_uuid=False), primary_key=True),
        sa.Column('workflow_id',  sa.String(36),  nullable=True,  index=True),
        sa.Column('flow_name',    sa.String(200), nullable=False),
        sa.Column('status',       sa.String(20),  nullable=False, default='pending', index=True),
        sa.Column('nodes',        JSONB,          nullable=False, server_default='[]'),
        sa.Column('edges',        JSONB,          nullable=False, server_default='[]'),
        sa.Column('logs',         JSONB,          nullable=False, server_default='[]'),
        sa.Column('final_state',  JSONB,          nullable=False, server_default='{}'),
        sa.Column('summary',      JSONB,          nullable=False, server_default='{}'),
        sa.Column('created_at',   sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_execution_runs_created_at', 'execution_runs', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_execution_runs_created_at', table_name='execution_runs')
    op.drop_table('execution_runs')
