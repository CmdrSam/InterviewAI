from __future__ import annotations

import json
import logging
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.gemini_service import GeminiInterviewService, decode_base64
from app.session_store import InterviewSession, get_session_store

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="InterviewAI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = get_session_store()
gemini = GeminiInterviewService()


def _ws_json(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/interview")
async def interview_ws(ws: WebSocket) -> None:
    await ws.accept()
    session: InterviewSession | None = None

    async def send(msg: dict[str, Any]) -> None:
        await ws.send_text(_ws_json(msg))

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await send({"type": "error", "message": "Invalid JSON"})
                continue

            mtype = msg.get("type")
            payload = msg.get("payload") or {}

            if mtype == "start":
                jd = (payload.get("job_description") or "").strip()
                name = (payload.get("candidate_name") or "Candidate").strip()
                if not jd:
                    await send({"type": "error", "message": "job_description is required"})
                    continue
                session = await store.create(jd, name)
                session.started = True
                await store.save(session)
                await send(
                    {
                        "type": "session",
                        "session_id": session.id,
                        "message": "Session created. Send 'ready' when camera is active.",
                    }
                )
                continue

            if session is None:
                await send({"type": "error", "message": "Send 'start' first"})
                continue

            session = await store.get(session.id) or session

            if mtype == "ready":
                if session.greeting_sent:
                    await send({"type": "error", "message": "Already greeted"})
                    continue
                img = decode_base64(payload.get("image_base64"))
                mime_img = payload.get("image_mime") or "image/jpeg"
                try:
                    text, q = await gemini.greeting_and_first_question(
                        session.job_description,
                        session.candidate_name,
                        session.asked_questions,
                        img,
                        mime_img,
                    )
                except Exception as e:
                    logger.exception("greeting failed")
                    await send({"type": "error", "message": str(e)})
                    continue
                session.greeting_sent = True
                session.chat_history.append({"role": "user", "parts": ["[Candidate ready — camera on]"]})
                session.chat_history.append({"role": "model", "parts": [text]})
                if q:
                    session.asked_questions.append(q)
                await store.save(session)
                await send({"type": "assistant_text", "text": text})
                continue

            if mtype == "turn":
                user_text = (payload.get("transcript") or "").strip()
                if not user_text:
                    await send({"type": "error", "message": "transcript is required"})
                    continue
                img = decode_base64(payload.get("image_base64"))
                mime_img = payload.get("image_mime") or "image/jpeg"
                audio = decode_base64(payload.get("audio_base64"))
                mime_audio = payload.get("audio_mime")
                session.transcript_log.append(
                    {"role": "candidate", "text": user_text}
                )
                try:
                    text, q = await gemini.reply_to_candidate(
                        session.job_description,
                        session.candidate_name,
                        session.chat_history,
                        user_text,
                        session.asked_questions,
                        img,
                        mime_img,
                        audio,
                        mime_audio,
                    )
                except Exception as e:
                    logger.exception("turn failed")
                    await send({"type": "error", "message": str(e)})
                    continue
                session.chat_history.append({"role": "user", "parts": [user_text]})
                session.chat_history.append({"role": "model", "parts": [text]})
                if q:
                    session.asked_questions.append(q)
                await store.save(session)
                await send({"type": "assistant_text", "text": text})
                continue

            if mtype == "end_interview":
                lines: list[str] = []
                for row in session.transcript_log:
                    who = row.get("role", "candidate")
                    t = row.get("text", "")
                    lines.append(f"{who}: {t}")
                for turn in session.chat_history:
                    if turn.get("role") == "model" and turn.get("parts"):
                        lines.append(f"interviewer: {turn['parts'][0]}")
                transcript = "\n".join(lines)
                try:
                    card = await gemini.build_scorecard(
                        session.job_description,
                        session.candidate_name,
                        transcript,
                    )
                except Exception as e:
                    logger.exception("scorecard failed")
                    await send({"type": "error", "message": str(e)})
                    continue
                await send({"type": "scorecard", "payload": card})
                continue

            await send({"type": "error", "message": f"Unknown type: {mtype}"})

    except WebSocketDisconnect:
        logger.info("client disconnected")
