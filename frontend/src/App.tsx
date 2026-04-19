import { useState } from "react";
import { useInterviewSession } from "./hooks/useInterviewSession";

const SAMPLE_JD = `Senior Backend Engineer

We need someone strong in distributed systems, Python or Go, PostgreSQL, and cloud (GCP). 
You'll design APIs, own reliability, and mentor juniors.`;

export default function App() {
  const [jd, setJd] = useState(SAMPLE_JD);
  const [name, setName] = useState("Alex");
  const [phase, setPhase] = useState<"setup" | "live" | "done">("setup");

  const s = useInterviewSession();

  const onBegin = () => {
    setPhase("live");
    s.connect(jd.trim(), name.trim() || "Candidate");
  };

  const onCameraReady = async () => {
    try {
      await s.startMedia();
      s.sendReady();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 bg-black/30 px-6 py-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">InterviewAI</h1>
            <p className="text-sm text-slate-400">Gemini-backed mock interview with camera and WebSockets</p>
          </div>
          {s.sessionId && (
            <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-slate-300">
              session {s.sessionId.slice(0, 8)}…
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-8 lg:grid-cols-2">
        {phase === "setup" && (
          <section className="lg:col-span-2 space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-400">
              Before you start
            </h2>
            <label className="block text-sm text-slate-300">
              Candidate name
              <input
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white outline-none focus:border-sky-500/60"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-300">
              Job description
              <textarea
                className="mt-1 min-h-[200px] w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-white outline-none focus:border-sky-500/60"
                value={jd}
                onChange={(e) => setJd(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-40"
              disabled={!jd.trim()}
              onClick={onBegin}
            >
              Connect &amp; start session
            </button>
            <p className="text-xs text-slate-500">
              Run the FastAPI server on port 8000, set <code className="text-slate-400">GEMINI_API_KEY</code> in{" "}
              <code className="text-slate-400">backend/.env</code>, then open this app.
            </p>
          </section>
        )}

        {phase === "live" && (
          <>
            <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-slate-200">Camera</h2>
                <div className="flex flex-wrap gap-2">
                  {!s.listening ? (
                    <button
                      type="button"
                      className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
                      onClick={onCameraReady}
                    >
                      Enable camera &amp; greet
                    </button>
                  ) : (
                    <span className="rounded-lg bg-emerald-950 px-3 py-1.5 text-xs text-emerald-200">
                      Live · VAD + mic
                    </span>
                  )}
                  <button
                    type="button"
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5"
                    onClick={() => {
                      s.endInterview();
                      setPhase("done");
                    }}
                  >
                    End &amp; scorecard
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5"
                    onClick={() => {
                      s.disconnect();
                      setPhase("setup");
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
              <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
                <video ref={s.videoRef} className="h-full w-full object-cover" playsInline muted />
                {!s.listening && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-slate-300">
                    Preview hidden until you enable the camera
                  </div>
                )}
              </div>
              {!s.speechSupported && (
                <p className="text-xs text-amber-200/90">
                  Speech recognition is not available in this browser. Type answers below and press Send.
                </p>
              )}
              <div className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-sky-500/60"
                  placeholder="Manual answer (if needed)"
                  value={s.manualAnswer}
                  onChange={(e) => s.setManualAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") s.submitManual();
                  }}
                />
                <button
                  type="button"
                  className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600"
                  onClick={s.submitManual}
                >
                  Send
                </button>
              </div>
            </section>

            <section className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              <h2 className="text-sm font-medium text-slate-200">Interviewer</h2>
              <div className="min-h-[120px] rounded-xl border border-white/10 bg-black/30 p-3 text-sm leading-relaxed text-slate-100">
                {s.assistantText || "Waiting for greeting…"}
              </div>
              <div>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Event log</h3>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-white/5 bg-black/25 p-2 font-mono text-[11px] text-slate-400">
                  {s.log.length === 0 ? (
                    <span className="text-slate-600">No events yet</span>
                  ) : (
                    s.log.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap break-words">
                        {line}
                      </div>
                    ))
                  )}
                </div>
              </div>
              {!s.connected && (
                <p className="text-xs text-rose-300/90">Not connected — check the API server and WebSocket URL.</p>
              )}
            </section>
          </>
        )}

        {phase === "done" && s.scorecard && (
          <section className="lg:col-span-2 space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-sm font-medium text-slate-200">Scorecard</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                <p className="text-xs uppercase text-slate-500">Technical fit</p>
                <p className="text-3xl font-semibold text-white">{s.scorecard.technical_fit}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                <p className="text-xs uppercase text-slate-500">Soft skills</p>
                <p className="text-3xl font-semibold text-white">{s.scorecard.soft_skills}</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-slate-200">{s.scorecard.summary}</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
              {s.scorecard.highlights?.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
            <button
              type="button"
              className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
              onClick={() => {
                setPhase("setup");
                s.disconnect();
              }}
            >
              New session
            </button>
          </section>
        )}

        {phase === "done" && !s.scorecard && (
          <section className="lg:col-span-2 rounded-2xl border border-amber-500/30 bg-amber-950/20 p-6 text-sm text-amber-100">
            Interview ended but no scorecard was returned. Check the log for API errors, then try again.
            <button
              type="button"
              className="ml-4 rounded-lg border border-white/20 px-3 py-1 text-xs"
              onClick={() => {
                setPhase("setup");
                s.disconnect();
              }}
            >
              Back
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
