import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { ACTIVITY_EVENT } from "../auth";

// Records a voice note or a whole session in the browser, sends it once for transcription, then
// drops it. Kumbuka never stores audio: only the transcript the counsellor chooses to keep.

const MAX_BYTES = 17 * 1024 * 1024;
const MAX_SECONDS = 90 * 60;
const TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"];

type Mode = "dictation" | "session";
type Phase = "idle" | "recording" | "paused" | "sending" | "failed";

function clock(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

export default function SessionRecorder({
  sessionId, isDemo, onTranscript,
}: { sessionId: number; isDemo: boolean; onTranscript: (text: string, mode: Mode) => void }) {
  const [mode, setMode] = useState<Mode>("session");
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const bytes = useRef(0);
  const pending = useRef<{ blob: Blob; secs: number } | null>(null);
  const tick = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const secsRef = useRef(0);

  const supported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  const live = phase === "recording" || phase === "paused";

  useEffect(() => () => stopTracks(), []);
  useEffect(() => {
    if (!live) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    // Keep the app from auto-locking while the counsellor is with the client.
    const keep = window.setInterval(() => window.dispatchEvent(new Event(ACTIVITY_EVENT)), 30_000);
    return () => { window.removeEventListener("beforeunload", warn); window.clearInterval(keep); };
  }, [live]);

  function stopTracks() {
    if (tick.current) window.clearInterval(tick.current);
    tick.current = null;
    rec.current?.stream.getTracks().forEach((t) => t.stop());
  }

  async function start() {
    setError(null); setNotice(null);
    if (mode === "session" && !consent) { setError("Tick the box to confirm the client agreed to be recorded."); return; }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("Kumbuka couldn't use the microphone. Allow microphone access for this site in your browser, then try again.");
      return;
    }
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 24_000 });
    chunks.current = []; bytes.current = 0;
    r.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.current.push(e.data);
      bytes.current += e.data.size;
      if (bytes.current > MAX_BYTES && r.state !== "inactive") {
        setNotice("The recording reached its size limit, so it stopped here.");
        r.stop();
      }
    };
    r.onstop = () => {
      stopTracks();
      const blob = new Blob(chunks.current, { type: (r.mimeType || mimeType || "audio/webm").split(";")[0] });
      chunks.current = [];
      void send(blob, secsRef.current);
    };
    rec.current = r;
    r.start(5000);
    setSeconds(0); secsRef.current = 0;
    setPhase("recording");
    tick.current = window.setInterval(() => {
      if (r.state !== "recording") return;
      secsRef.current += 1;
      setSeconds(secsRef.current);
      if (secsRef.current >= MAX_SECONDS) { setNotice("Recordings stop at 90 minutes."); r.stop(); }
    }, 1000);
  }

  function pause() {
    const r = rec.current; if (!r) return;
    if (r.state === "recording") { r.pause(); setPhase("paused"); }
    else if (r.state === "paused") { r.resume(); setPhase("recording"); }
  }

  function stop() { if (rec.current && rec.current.state !== "inactive") rec.current.stop(); }

  function discard() {
    if (rec.current) { rec.current.onstop = () => stopTracks(); if (rec.current.state !== "inactive") rec.current.stop(); }
    chunks.current = []; pending.current = null;
    setPhase("idle"); setSeconds(0); setNotice("Recording discarded.");
  }

  async function send(blob: Blob, secs: number) {
    pending.current = { blob, secs };
    setPhase("sending"); setError(null);
    try {
      const r = await api.transcribe(sessionId, blob, mode, mode === "session" && consent, secs || undefined);
      pending.current = null;
      setPhase("idle");
      if (r.transcript.trim() === "[no speech detected]") { setNotice("No speech was picked up. Check the microphone and try again."); return; }
      onTranscript(r.transcript, mode);
      setNotice("Transcript added to your notes. The audio has been discarded.");
    } catch (e) {
      setPhase("failed");
      setError((e as Error).message);
    }
  }

  function upload(f: File | undefined) {
    if (!f) return;
    setError(null); setNotice(null);
    if (mode === "session" && !consent) { setError("Tick the box to confirm the client agreed to be recorded."); return; }
    if (f.size > MAX_BYTES) { setError("That file is over 17 MB. Trim it or record at a lower quality."); return; }
    void send(f, 0);
  }

  return (
    <div className="mt-4 rounded-lg bg-paper p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold">Record and transcribe</h3>
        {!live && phase !== "sending" && (
          <div role="radiogroup" aria-label="What to record" className="flex rounded-md bg-mist p-0.5 text-sm">
            {(["session", "dictation"] as const).map((m) => (
              <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                className={`rounded px-2.5 py-1 font-bold ${mode === m ? "bg-paper text-ink shadow-sm" : "text-muted"}`}>
                {m === "session" ? "The session" : "A voice note"}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">
        {mode === "session"
          ? "Record the conversation with the client's agreement. You get a transcript with Counsellor and Client turns, in whatever languages were spoken."
          : "Speak your own notes after the session, in English, Kiswahili or a mix."}
      </p>

      {mode === "session" && !live && phase !== "sending" && (
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>The client agreed to this session being recorded and transcribed.{isDemo && " (Demo: please don't record real clients.)"}</span>
        </label>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {phase === "idle" && supported && (
          <button className="btn btn-primary" onClick={start}>
            <span aria-hidden className="size-2.5 rounded-full bg-mist" /> Start recording
          </button>
        )}
        {live && (
          <>
            <span className="inline-flex items-center gap-2 rounded-md bg-risk-soft px-3 py-1.5 font-bold tabular-nums text-risk" aria-live="polite">
              <span aria-hidden className={`size-2.5 rounded-full bg-risk ${phase === "recording" ? "animate-pulse" : ""}`} />
              {phase === "paused" ? "Paused" : "Recording"} {clock(seconds)}
            </span>
            <button className="btn btn-quiet" onClick={pause}>{phase === "paused" ? "Resume" : "Pause"}</button>
            <button className="btn btn-primary" onClick={stop}>Stop and transcribe</button>
            <button className="btn btn-quiet text-risk" onClick={discard}>Discard</button>
          </>
        )}
        {phase === "sending" && <p className="text-sm font-bold text-pine" aria-live="polite">Transcribing… a long session can take a minute or two.</p>}
        {phase === "failed" && pending.current && (
          <>
            <button className="btn btn-primary" onClick={() => pending.current && send(pending.current.blob, pending.current.secs)}>Try again</button>
            <button className="btn btn-quiet" onClick={discard}>Discard recording</button>
          </>
        )}
        {phase === "idle" && (
          <>
            <button className="btn btn-quiet" onClick={() => fileRef.current?.click()}>Upload a recording</button>
            <input ref={fileRef} type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.webm" className="hidden"
              onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
          </>
        )}
      </div>
      {!supported && phase === "idle" && <p className="mt-2 text-xs text-muted">This browser can't record audio, but you can upload a recording from your phone.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-risk">{error}</p>}
      {notice && !error && <p className="mt-2 text-sm text-pine-deep">{notice}</p>}
      <p className="mt-2 text-xs text-muted">
        Audio goes to the AI service once, for transcription, and is never stored by Kumbuka. Names and phone numbers
        are replaced with [name] and [phone]. Keep this page open while recording; it won't auto-lock.
      </p>
    </div>
  );
}
