from __future__ import annotations

import json
import uuid
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from typing import Any

from app.config import settings


@dataclass
class InterviewSession:
    id: str
    job_description: str
    candidate_name: str
    asked_questions: list[str] = field(default_factory=list)
    transcript_log: list[dict[str, Any]] = field(default_factory=list)
    chat_history: list[dict[str, Any]] = field(default_factory=list)
    started: bool = False
    greeting_sent: bool = False

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, raw: str) -> InterviewSession:
        d = json.loads(raw)
        return cls(**d)


class SessionStore(ABC):
    @abstractmethod
    async def create(
        self, job_description: str, candidate_name: str
    ) -> InterviewSession:
        pass

    @abstractmethod
    async def get(self, session_id: str) -> InterviewSession | None:
        pass

    @abstractmethod
    async def save(self, session: InterviewSession) -> None:
        pass


class MemorySessionStore(SessionStore):
    def __init__(self) -> None:
        self._data: dict[str, InterviewSession] = {}

    async def create(
        self, job_description: str, candidate_name: str
    ) -> InterviewSession:
        sid = str(uuid.uuid4())
        s = InterviewSession(
            id=sid,
            job_description=job_description,
            candidate_name=candidate_name,
        )
        self._data[sid] = s
        return s

    async def get(self, session_id: str) -> InterviewSession | None:
        return self._data.get(session_id)

    async def save(self, session: InterviewSession) -> None:
        self._data[session.id] = session


class RedisSessionStore(SessionStore):
    def __init__(self, url: str) -> None:
        import redis.asyncio as redis

        self._redis = redis.from_url(url, decode_responses=True)
        self._prefix = "interviewai:session:"

    def _key(self, session_id: str) -> str:
        return f"{self._prefix}{session_id}"

    async def create(
        self, job_description: str, candidate_name: str
    ) -> InterviewSession:
        sid = str(uuid.uuid4())
        s = InterviewSession(
            id=sid,
            job_description=job_description,
            candidate_name=candidate_name,
        )
        await self.save(s)
        return s

    async def get(self, session_id: str) -> InterviewSession | None:
        raw = await self._redis.get(self._key(session_id))
        if not raw:
            return None
        return InterviewSession.from_json(raw)

    async def save(self, session: InterviewSession) -> None:
        await self._redis.set(self._key(session.id), session.to_json())


def get_session_store() -> SessionStore:
    if settings.redis_url:
        return RedisSessionStore(settings.redis_url)
    return MemorySessionStore()
