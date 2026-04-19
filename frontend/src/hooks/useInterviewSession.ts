import { useCallback, useEffect, useRef, useState } from "react";

type ServerMessage =
  | { type: "session"; session_id: string; message?: string }
  | { type: "assistant_text"; text: string }
  | { type: "scorecard"; payload: Scorecard }
  | { type: "error"; message: string };

export type Scorecard = {
  technical_fit: number;
  soft_skills: number;
  summary: string;
  highlights: string[];
};

const defaultWs = () => {
  const u = import.meta.env.VITE_WS_URL;
  if (u) return u;
  const { protocol, hostname } = window.location;
  const wsProto = protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${hostname}:8000/ws/interview`;
};

export function useInterviewSession() {
  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastJpegRef = useRef<{ b64: string; mime: string } | null>(null);
  const vadRef = useRef({
    speaking: false,
    silenceMs: 0,
    lastSpeechAt: 0,
  });
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptBufRef = useRef("");
  const isListeningRef = useRef(false);
  const turnLockRef = useRef(false);
  const finalizeRef = useRef<() => void>(() => {});

  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [assistantText, setAssistantText] = useState("");
  const [scorecard, setScorecard] = useState<Scorecard | null>(null);
  const [listening, setListening] = useState(false);
  const [manualAnswer, setManualAnswer] = useState("");
  const [speechSupported, setSpeechSupported] = useState(true);

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-80), line]);
  }, []);

  const speak = useCallback((text: string) => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    window.speechSynthesis.speak(u);
  }, []);

  const sendJson = useCallback((obj: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }, []);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const w = Math.min(640, video.videoWidth);
    const h = Math.round((w / video.videoWidth) * video.videoHeight);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = c.toDataURL("image/jpeg", 0.68);
    const i = dataUrl.indexOf(",");
    lastJpegRef.current = {
      b64: i >= 0 ? dataUrl.slice(i + 1) : dataUrl,
      mime: "image/jpeg",
    };
  }, []);

  const stopMedia = useCallback(() => {
    isListeningRef.current = false;
    if (frameTimerRef.current) {
      clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    cancelAnimationFrame(rafRef.current);
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    analyserRef.current = null;
    setListening(false);
  }, []);

  const finalizeUserTurn = useCallback(() => {
    if (turnLockRef.current) return;
    const text = transcriptBufRef.current.trim();
    if (!text) return;
    turnLockRef.current = true;
    transcriptBufRef.current = "";
    const snap = lastJpegRef.current;
    sendJson({
      type: "turn",
      payload: {
        transcript: text,
        image_base64: snap?.b64,
        image_mime: snap?.mime,
      },
    });
    pushLog(`you: ${text}`);
    window.setTimeout(() => {
      turnLockRef.current = false;
    }, 800);
  }, [pushLog, sendJson]);

  finalizeRef.current = finalizeUserTurn;

  const startMedia = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 } },
      audio: true,
    });
    streamRef.current = stream;
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      await video.play();
    }
    captureFrame();
    frameTimerRef.current = setInterval(captureFrame, 1500);

    const audioCtx = new AudioContext();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analyserRef.current = analyser;

    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      const a = analyserRef.current;
      if (!a) return;
      a.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum += Math.abs(data[i] - 128);
      }
      const level = sum / data.length / 128;
      const now = performance.now();
      const v = vadRef.current;
      const speech = level > 0.018;
      if (speech) {
        v.speaking = true;
        v.silenceMs = 0;
        v.lastSpeechAt = now;
        window.speechSynthesis.cancel();
      } else if (v.speaking) {
        v.silenceMs += 16;
        if (v.silenceMs > 500 && now - v.lastSpeechAt > 400) {
          v.speaking = false;
          v.silenceMs = 0;
          finalizeRef.current();
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      const recog = new SR();
      recog.continuous = true;
      recog.interimResults = true;
      recog.lang = "en-US";
      recog.onresult = (ev: SpeechRecognitionEvent) => {
        let text = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          text += ev.results[i][0].transcript;
        }
        transcriptBufRef.current = text.trim();
      };
      recog.onerror = () => {
        /* non-fatal */
      };
      recog.onend = () => {
        if (isListeningRef.current) {
          try {
            recog.start();
          } catch {
            /* already started */
          }
        }
      };
      recognitionRef.current = recog;
      recog.start();
      setSpeechSupported(true);
    } else {
      setSpeechSupported(false);
    }
    isListeningRef.current = true;
    setListening(true);
  }, [captureFrame]);

  const connect = useCallback(
    (jobDescription: string, candidateName: string) => {
      const url = defaultWs();
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        ws.send(
          JSON.stringify({
            type: "start",
            payload: {
              job_description: jobDescription,
              candidate_name: candidateName,
            },
          }),
        );
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMessage;
        if (msg.type === "session") {
          setSessionId(msg.session_id);
          pushLog(msg.message || "Session ready");
        } else if (msg.type === "assistant_text") {
          setAssistantText(msg.text);
          speak(msg.text);
          pushLog(`interviewer: ${msg.text}`);
        } else if (msg.type === "scorecard") {
          setScorecard(msg.payload);
          pushLog("Scorecard received");
        } else if (msg.type === "error") {
          pushLog(`error: ${msg.message}`);
        }
      };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
      };
      ws.onerror = () => {
        pushLog("WebSocket error");
      };
    },
    [pushLog, speak],
  );

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    stopMedia();
    setConnected(false);
    setSessionId(null);
  }, [stopMedia]);

  const sendReady = useCallback(() => {
    captureFrame();
    const snap = lastJpegRef.current;
    sendJson({
      type: "ready",
      payload: {
        image_base64: snap?.b64,
        image_mime: snap?.mime,
      },
    });
  }, [captureFrame, sendJson]);

  const endInterview = useCallback(() => {
    sendJson({ type: "end_interview", payload: {} });
  }, [sendJson]);

  const submitManual = useCallback(() => {
    const text = manualAnswer.trim();
    if (!text) return;
    setManualAnswer("");
    const snap = lastJpegRef.current;
    sendJson({
      type: "turn",
      payload: {
        transcript: text,
        image_base64: snap?.b64,
        image_mime: snap?.mime,
      },
    });
    pushLog(`you: ${text}`);
  }, [manualAnswer, pushLog, sendJson]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    videoRef,
    connected,
    sessionId,
    log,
    assistantText,
    scorecard,
    listening,
    speechSupported,
    manualAnswer,
    setManualAnswer,
    connect,
    disconnect,
    startMedia,
    stopMedia,
    sendReady,
    endInterview,
    submitManual,
    speak,
  };
}
