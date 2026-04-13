"""create workflows table

Revision ID: 8b9a437ce279
Revises:
Create Date: 2025-01-01 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = '8b9a437ce279'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'workflows',
        sa.Column('id', UUID(as_uuid=False), primary_key=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('tags', JSONB(), nullable=True, server_default='[]'),
        sa.Column('nodes', JSONB(), nullable=False, server_default='[]'),
        sa.Column('edges', JSONB(), nullable=False, server_default='[]'),
        sa.Column('max_iterations', sa.Integer(), nullable=False, server_default='5'),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
    )
    # Index for fast name searches
    op.create_index('ix_workflows_name', 'workflows', ['name'])
    # Index for fast recency-ordered list
    op.create_index('ix_workflows_updated_at', 'workflows', ['updated_at'])
    # GIN index for JSONB tag queries (e.g. tags @> '["research"]')
    op.create_index(
        'ix_workflows_tags_gin', 'workflows', ['tags'],
        postgresql_using='gin',
    )


def downgrade() -> None:
    op.drop_index('ix_workflows_tags_gin', table_name='workflows')
    op.drop_index('ix_workflows_updated_at', table_name='workflows')
    op.drop_index('ix_workflows_name', table_name='workflows')
    op.drop_table('workflows')
