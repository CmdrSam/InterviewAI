# InterviewAI

AI-assisted mock interview: **React (Vite) + Tailwind** frontend, **FastAPI + WebSockets** backend, **Gemini** for recruiter persona, multimodal turns (JPEG frame + transcript), and a JSON **scorecard** at the end.

## Architecture

- **Phase 1 — context:** Client sends job description and candidate name over the WebSocket; the server creates a session (in-memory by default, optional **Redis**).
- **Phase 2 — loop:** After `getUserMedia`, the client sends `ready` with a sampled video frame; the model returns a greeting and first question. On each answer, the client sends `turn` with transcript + latest frame. Simple **VAD** (Web Audio RMS) ends a turn; **barge-in** cancels `speechSynthesis` while the user speaks. **Web Speech API** provides the transcript in supported browsers; otherwise use the manual text box.
- **Reporting:** `end_interview` triggers a Gemini-generated scorecard (technical fit, soft skills, summary, highlights).

## Prerequisites

- Python 3.11+
- Node.js 20+
- A [Google AI Studio](https://aistudio.google.com/) API key (`GEMINI_API_KEY`)

## Backend

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate   # Windows
pip install -r requirements.txt
copy .env.example .env     # set GEMINI_API_KEY
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Optional: set `REDIS_URL` (e.g. `redis://localhost:6379/0`) for session storage across workers. Override the model with `GEMINI_MODEL` if your project does not expose `gemini-2.5-flash`.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

If the UI is not served from the same host as the API, set `VITE_WS_URL` (e.g. `ws://127.0.0.1:8000/ws/interview`).

## Live / low-latency audio (next step)

This scaffold uses **WebSockets + sampled frames + browser STT** so it runs without Vertex setup. For sub-second spoken replies, wire **Gemini Live / native audio** ([Gemini API Live](https://ai.google.dev/gemini-api/docs/live)) and replace the `speechSynthesis` path with streamed TTS from the model.

## Deployment sketch

- Frontend: **Vercel** (static build: `npm run build`, output `frontend/dist`).
- Backend: **Cloud Run** (Docker or buildpack) with `GEMINI_API_KEY` as a secret and `CORS_ORIGINS` pointing at your Vercel URL.
