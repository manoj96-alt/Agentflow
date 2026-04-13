from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import datetime
import uuid


AgentModel = Literal[
    "claude-opus-4-5",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
    "gpt-4o",
    "gpt-4o-mini",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
]


class AgentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Display name of the agent")
    prompt: str = Field(..., min_length=1, description="System prompt for the agent")
    model: AgentModel = Field(default="claude-sonnet-4-5", description="LLM model to use")
    memory: bool = Field(default=False, description="Whether the agent retains memory across turns")


class Agent(AgentCreate):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique agent identifier")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        json_encoders = {datetime: lambda v: v.isoformat()}


class AgentResponse(BaseModel):
    """Returned for list and single-fetch endpoints."""
    id: str
    name: str
    prompt: str
    model: str
    memory: bool
    created_at: str
    updated_at: str

    @classmethod
    def from_agent(cls, agent: Agent) -> "AgentResponse":
        return cls(
            id=agent.id,
            name=agent.name,
            prompt=agent.prompt,
            model=agent.model,
            memory=agent.memory,
            created_at=agent.created_at.isoformat(),
            updated_at=agent.updated_at.isoformat(),
        )
