import { useEffect, useRef, useState } from "react";

// Browser speech recognition (Chrome, Edge, Safari). Audio is processed by the browser's
// speech service; nothing is recorded or stored by Kumbuka.
type Rec = {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] & { length: number } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getCtor(): (new () => Rec) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as (new () => Rec) | null;
}

export function useDictation(onFinal: (text: string) => void) {
  const supported = typeof window !== "undefined" && !!getCtor();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  const want = useRef(false);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  useEffect(() => () => { want.current = false; rec.current?.stop(); }, []);

  function start() {
    const Ctor = getCtor();
    if (!Ctor) return;
    setError(null);
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-GB";
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) cb.current(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") { setError("Microphone access was blocked. Allow it in the browser's address bar."); want.current = false; }
      else if (e.error !== "no-speech" && e.error !== "aborted") setError(`Dictation stopped (${e.error}).`);
    };
    // Browsers end recognition after silence; restart while the user still wants it.
    r.onend = () => {
      setInterim("");
      if (want.current) { try { r.start(); } catch { setListening(false); } }
      else setListening(false);
    };
    rec.current = r;
    want.current = true;
    r.start();
    setListening(true);
  }

  function stop() {
    want.current = false;
    rec.current?.stop();
    setListening(false);
  }

  return { supported, listening, interim, error, start, stop };
}
