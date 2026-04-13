from typing import Dict, List, Optional
from datetime import datetime
from app.models.agent import Agent, AgentCreate


# In-memory store — swap for SQLAlchemy + DB in production
_store: Dict[str, Agent] = {}


class AgentService:
    def get_all(self) -> List[Agent]:
        return list(_store.values())

    def get_by_id(self, agent_id: str) -> Optional[Agent]:
        return _store.get(agent_id)

    def create(self, data: AgentCreate) -> Agent:
        agent = Agent(**data.model_dump())
        _store[agent.id] = agent
        return agent

    def update(self, agent_id: str, data: AgentCreate) -> Optional[Agent]:
        if agent_id not in _store:
            return None
        existing = _store[agent_id]
        updated = Agent(
            id=agent_id,
            created_at=existing.created_at,
            updated_at=datetime.utcnow(),
            **data.model_dump(),
        )
        _store[agent_id] = updated
        return updated

    def delete(self, agent_id: str) -> bool:
        if agent_id not in _store:
            return False
        del _store[agent_id]
        return True


agent_service = AgentService()
