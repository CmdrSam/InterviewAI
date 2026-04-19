from __future__ import annotations

import base64
import json
import re
from typing import Any

import google.generativeai as genai

from app.config import settings
from app.prompts import scorecard_prompt, system_instruction


def _configure() -> None:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    genai.configure(api_key=settings.gemini_api_key)


def _history_to_gemini(chat_history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for turn in chat_history:
        role = turn.get("role")
        if role not in ("user", "model"):
            continue
        parts = turn.get("parts")
        if isinstance(parts, list) and parts:
            out.append({"role": role, "parts": parts})
    return out


def _extract_json_object(text: str) -> dict[str, Any] | None:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", text)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            return None
    return None


class GeminiInterviewService:
    def __init__(self) -> None:
        self._model_name = settings.gemini_model

    def _ensure_configured(self) -> None:
        _configure()

    def _model_for_session(self, job_description: str, candidate_name: str):
        self._ensure_configured()
        return genai.GenerativeModel(
            model_name=self._model_name,
            system_instruction=system_instruction(job_description, candidate_name),
        )

    async def greeting_and_first_question(
        self,
        job_description: str,
        candidate_name: str,
        asked_questions: list[str],
        image_bytes: bytes | None,
        image_mime: str,
    ) -> tuple[str, str | None]:
        model = self._model_for_session(job_description, candidate_name)
        prior = "\n".join(f"- {q}" for q in asked_questions) or "(none yet)"
        prompt = f"""The candidate's camera is on. Give a warm, short greeting by name, then ask the first interview question aligned with the JD.
Already asked (do not repeat): 
{prior}
"""
        parts: list[Any] = [prompt]
        if image_bytes:
            parts.append({"mime_type": image_mime, "data": image_bytes})

        resp = await model.generate_content_async(parts)
        text = (resp.text or "").strip()
        return text, self._first_question_from_text(text)

    async def reply_to_candidate(
        self,
        job_description: str,
        candidate_name: str,
        chat_history: list[dict[str, Any]],
        user_text: str,
        asked_questions: list[str],
        image_bytes: bytes | None,
        image_mime: str,
        audio_bytes: bytes | None,
        audio_mime: str | None,
    ) -> tuple[str, str | None]:
        model = self._model_for_session(job_description, candidate_name)
        prior = "\n".join(f"- {q}" for q in asked_questions) or "(none yet)"
        user_parts: list[Any] = [
            f"Candidate transcript (what they said):\n{user_text}\n\nDo not repeat prior questions:\n{prior}\n\nRespond as the interviewer: acknowledge briefly, then continue (follow-up or next core question)."
        ]
        if image_bytes:
            user_parts.append(
                {"mime_type": image_mime, "data": image_bytes}
            )
        if audio_bytes and audio_mime:
            user_parts.append({"mime_type": audio_mime, "data": audio_bytes})

        hist = _history_to_gemini(chat_history)
        chat = model.start_chat(history=hist)
        resp = await chat.send_message_async(user_parts)
        text = (resp.text or "").strip()
        return text, self._first_question_from_text(text)

    def _first_question_from_text(self, assistant_text: str) -> str | None:
        lines = [ln.strip() for ln in assistant_text.splitlines() if ln.strip()]
        for ln in lines:
            if "?" in ln:
                return ln
        return None

    async def build_scorecard(
        self, job_description: str, candidate_name: str, transcript: str
    ) -> dict[str, Any]:
        self._ensure_configured()
        model = genai.GenerativeModel(model_name=self._model_name)
        prompt = scorecard_prompt(job_description, candidate_name, transcript)
        resp = await model.generate_content_async(prompt)
        raw = (resp.text or "").strip()
        parsed = _extract_json_object(raw)
        if not parsed:
            return {
                "technical_fit": 0,
                "soft_skills": 0,
                "summary": raw or "Could not parse scorecard.",
                "highlights": [],
            }
        return parsed


def decode_base64(data: str | None) -> bytes | None:
    if not data:
        return None
    return base64.b64decode(data)
