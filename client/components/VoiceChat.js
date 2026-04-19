"use client";

import { useEffect, useRef, useState } from "react";
import { createSocket } from "../lib/socket";

export default function VoiceChat() {
  const socketRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const isAITalkingRef = useRef(false);
  const isRecordingRef = useRef(false); // true only while button is held

  const [status, setStatus] = useState("connecting");
  const [transcript, setTranscript] = useState("");
  const [aiText, setAiText] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    audioContextRef.current = new AudioContext();

    socketRef.current = createSocket({
      onTranscript: (text) => {
        setTranscript(text);
      },
      onAIText: (text) => {
        setAiText(text);
        setStatus("ai_talking");
      },
      onAudio: (arrayBuffer) => {
        playAudio(arrayBuffer);
      },
      onError: (msg) => {
        setError(msg);
        setStatus("error");
      },
    });

    setTimeout(() => {
      startMic();
      setStatus("ready");
    }, 500);

    return () => {
      socketRef.current?.close();
      mediaRecorderRef.current?.stop();
      audioContextRef.current?.close();
    };
  }, []);

  // --- Mic Streaming ---
  // MediaRecorder runs CONTINUOUSLY — we just gate which chunks get sent
  const startMic = async () => {
    try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorderRef.current = mediaRecorder;

    let headerChunk = null; // store the very first chunk (webm header)

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;

      // Always capture the first chunk as the header
      if (!headerChunk) {
        headerChunk = event.data;
        return; // don't send it yet — just store it
      }

      // Only send when button is held and AI isn't talking
      if (isRecordingRef.current && !isAITalkingRef.current) {
        // Always send header first so server gets a valid webm file
        socketRef.current?.sendAudio(headerChunk);
        socketRef.current?.sendAudio(event.data);
      }
    };

    mediaRecorder.start(250);
  } catch (err) {
    setError("Microphone access denied");
    setStatus("error");
    }
  };

  // --- Audio Playback ---
  const playAudio = async (arrayBuffer) => {
    try {
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") await ctx.resume();

      isAITalkingRef.current = true;
      setStatus("ai_talking");

      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      source.onended = () => {
        isAITalkingRef.current = false;
        setStatus("ready");
      };

      source.start();
    } catch (err) {
      console.error("Audio playback error:", err);
      isAITalkingRef.current = false;
      setStatus("ready");
    }
  };

  // --- Status Label ---
  const statusLabel = {
    connecting: "Connecting...",
    ready: "Ready — hold to speak",
    listening: "🎤 Listening...",
    ai_talking: "🤖 AI Responding...",
    error: "❌ Error",
  }[status];

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>SimuSales</h1>
      <p style={styles.subtitle}>AI Sales Training Simulator</p>

      {/* Status indicator */}
      <div style={{ ...styles.statusBadge, backgroundColor: statusColors[status] }}>
        {statusLabel}
      </div>

      {/* Hold to speak button */}
      <button
        onMouseDown={() => {
          isRecordingRef.current = true;
          setStatus("listening");
        }}
        onMouseUp={() => {
          isRecordingRef.current = false;
          socketRef.current?.sendEndOfSpeech();
          setStatus("ready");
        }}
        onMouseLeave={() => {
          // Safety: if mouse leaves button while held, treat as release
          if (isRecordingRef.current) {
            isRecordingRef.current = false;
            socketRef.current?.sendEndOfSpeech();
            setStatus("ready");
          }
        }}
        disabled={status === "ai_talking" || status === "connecting"}
        style={{
          ...styles.button,
          opacity: status === "ai_talking" || status === "connecting" ? 0.4 : 1,
          cursor: status === "ai_talking" || status === "connecting" ? "not-allowed" : "pointer",
        }}
      >
        🎤 Hold to Speak
      </button>

      {/* Transcript */}
      {transcript && (
        <div style={styles.card}>
          <p style={styles.label}>You said:</p>
          <p style={styles.text}>{transcript}</p>
        </div>
      )}

      {/* AI Response */}
      {aiText && (
        <div style={{ ...styles.card, ...styles.aiCard }}>
          <p style={styles.label}>Prospect:</p>
          <p style={styles.text}>{aiText}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={styles.errorCard}>
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}

// --- Styles ---
const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    backgroundColor: "#0f0f0f",
    color: "#fff",
    fontFamily: "monospace",
    padding: "2rem",
    gap: "1.5rem",
  },
  title: {
    fontSize: "2.5rem",
    fontWeight: "bold",
    letterSpacing: "0.1em",
    margin: 0,
  },
  subtitle: {
    fontSize: "0.9rem",
    color: "#888",
    margin: 0,
    letterSpacing: "0.2em",
    textTransform: "uppercase",
  },
  statusBadge: {
    padding: "0.4rem 1.2rem",
    borderRadius: "999px",
    fontSize: "0.85rem",
    fontWeight: "bold",
    color: "#000",
    transition: "background-color 0.3s ease",
  },
  button: {
    padding: "1rem 2.5rem",
    borderRadius: "999px",
    border: "none",
    backgroundColor: "#4ade80",
    color: "#000",
    fontSize: "1rem",
    fontWeight: "bold",
    fontFamily: "monospace",
    transition: "opacity 0.2s ease",
    userSelect: "none",
  },
  card: {
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: "12px",
    padding: "1rem 1.5rem",
    maxWidth: "600px",
    width: "100%",
  },
  aiCard: {
    borderColor: "#444",
    background: "#1e1e2e",
  },
  label: {
    fontSize: "0.7rem",
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    marginBottom: "0.4rem",
  },
  text: {
    fontSize: "1rem",
    lineHeight: "1.6",
    margin: 0,
  },
  errorCard: {
    background: "#2a0000",
    border: "1px solid #ff4444",
    borderRadius: "12px",
    padding: "1rem 1.5rem",
    color: "#ff4444",
    fontSize: "0.9rem",
  },
};

const statusColors = {
  connecting: "#888",
  ready: "#aaa",
  listening: "#4ade80",
  ai_talking: "#60a5fa",
  error: "#f87171",
};