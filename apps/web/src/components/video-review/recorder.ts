import { useEffect, useRef, useState } from "react";

/** The microphone for one note: tap to start, tap again to stop and send it to be transcribed. */
export function useNoteRecorder(onTake: (blob: Blob, fileName: string) => void, onBlocked: () => void) {
  const [state, setState] = useState<"idle" | "rec">("idle");
  const rec = useRef<{ recorder: MediaRecorder; chunks: Blob[]; stream: MediaStream } | null>(null);
  useEffect(
    () => () => {
      for (const track of rec.current?.stream.getTracks() ?? []) track.stop();
    },
    [],
  );
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // An iPhone plays and sends mp4; the others record webm.
      const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start();
      rec.current = { recorder, chunks, stream };
      setState("rec");
    } catch {
      onBlocked();
    }
  };
  const stop = () => {
    const current = rec.current;
    if (!current) return;
    rec.current = null;
    current.recorder.onstop = () => {
      for (const track of current.stream.getTracks()) track.stop();
      const type = (current.recorder.mimeType || "audio/webm").split(";")[0] ?? "audio/webm";
      const blob = new Blob(current.chunks, { type });
      setState("idle");
      if (blob.size > 0) onTake(blob, type.includes("mp4") ? "nota.m4a" : "nota.webm");
    };
    current.recorder.stop();
  };
  return { recording: state === "rec", start, stop };
}
