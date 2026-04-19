"use client";

import { useEffect, useRef, useState } from "react";
import { createSocket } from "../lib/socket";

const DIFFICULTY_CONFIG = {
  easy:       { label: "Easy",       color: "#4ade80", bg: "#052e16" },
  medium:     { label: "Medium",     color: "#facc15", bg: "#1c1700" },
  hard:       { label: "Hard",       color: "#f97316", bg: "#1c0a00" },
  unwinnable: { label: "Unwinnable", color: "#ef4444", bg: "#1c0000" },
};

// ─── Persona Selector Screen ──────────────────────────────────────────────────
function PersonaSelector({ onSelect }) {
  const [personas, setPersonas] = useState([]);
  const [hovered, setHovered] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("http://localhost:3001/personas")
      .then((r) => r.json())
      .then((data) => {
        setPersonas(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={styles.fullCenter}>
        <p style={{ color: "#555", fontFamily: "monospace" }}>Loading prospects...</p>
      </div>
    );
  }

  return (
    <div style={styles.selectorContainer}>
      {/* Header */}
      <div style={styles.selectorHeader}>
        <h1 style={styles.selectorTitle}>SimuSales</h1>
        <p style={styles.selectorSubtitle}>Choose your prospect</p>
        <p style={styles.selectorHint}>Each conversation is a live simulation. Pick your challenge.</p>
      </div>

      {/* Cards Grid */}
      <div style={styles.grid}>
        {personas.map((p) => {
          const diff = DIFFICULTY_CONFIG[p.difficulty] || DIFFICULTY_CONFIG.hard;
          const isHovered = hovered === p.key;

          return (
            <div
              key={p.key}
              onClick={() => onSelect(p)}
              onMouseEnter={() => setHovered(p.key)}
              onMouseLeave={() => setHovered(null)}
              style={{
                ...styles.card,
                borderColor: isHovered ? diff.color : "#222",
                backgroundColor: isHovered ? diff.bg : "#111",
                transform: isHovered ? "translateY(-4px)" : "translateY(0)",
                boxShadow: isHovered ? `0 8px 32px ${diff.color}22` : "none",
              }}
            >
              {/* Emoji */}
              <div style={styles.cardEmoji}>{p.emoji}</div>

              {/* Difficulty badge */}
              <div style={{
                ...styles.diffBadge,
                color: diff.color,
                borderColor: diff.color,
              }}>
                {diff.label}
              </div>

              {/* Name + title */}
              <h2 style={styles.cardName}>{p.name}</h2>
              <p style={styles.cardTitle}>{p.title}</p>

              {/* Description */}
              <p style={styles.cardDesc}>{p.description}</p>

              {/* Winnable indicator */}
              <div style={styles.cardFooter}>
                {p.winnable
                  ? <span style={{ color: "#4ade80", fontSize: "0.75rem" }}>🏆 Winnable</span>
                  : <span style={{ color: "#ef4444", fontSize: "0.75rem" }}>💀 Unwinnable</span>
                }
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Call Screen ──────────────────────────────────────────────────────────────
function CallScreen({ persona, onExit }) {
  const socketRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const isAITalkingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const feedbackTimerRef = useRef(null);

  const [status, setStatus] = useState("connecting");
  const [transcript, setTranscript] = useState("");
  const [aiText, setAiText] = useState("");
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [feedbackVisible, setFeedbackVisible] = useState(false);

  const diff = DIFFICULTY_CONFIG[persona.difficulty] || DIFFICULTY_CONFIG.hard;

  useEffect(() => {
    audioContextRef.current = new AudioContext();

    socketRef.current = createSocket({
      personaKey: persona.key,
      onTranscript: (text) => setTranscript(text),
      onAIText: (text) => { setAiText(text); setStatus("ai_talking"); },
      onAudio: (arrayBuffer) => playAudio(arrayBuffer),
      onFeedback: (data) => showFeedback(data),
      onError: (msg) => { setError(msg); setStatus("error"); },
    });

    setTimeout(() => {
      startMic();
      setStatus("ready");
    }, 500);

    return () => {
      socketRef.current?.close();
      mediaRecorderRef.current?.stop();
      audioContextRef.current?.close();
      clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const showFeedback = (data) => {
    clearTimeout(feedbackTimerRef.current);
    setFeedback(data);
    setFeedbackVisible(true);
    feedbackTimerRef.current = setTimeout(() => {
      setFeedbackVisible(false);
      setTimeout(() => setFeedback(null), 400);
    }, 4000);
  };

  const startMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;

      let headerChunk = null;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        if (!headerChunk) { headerChunk = event.data; return; }
        if (isRecordingRef.current && !isAITalkingRef.current) {
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
      source.onended = () => { isAITalkingRef.current = false; setStatus("ready"); };
      source.start();
    } catch (err) {
      console.error("Audio playback error:", err);
      isAITalkingRef.current = false;
      setStatus("ready");
    }
  };

  const statusLabel = {
    connecting: "Connecting...",
    ready: "Ready — hold to speak",
    listening: "🎤 Listening...",
    ai_talking: "🤖 Prospect speaking...",
    error: "❌ Error",
  }[status];

  const feedbackBg    = { warning: "#7f1d1d", tip: "#1e3a5f", praise: "#14532d" };
  const feedbackBorder = { warning: "#ef4444", tip: "#3b82f6", praise: "#22c55e" };

  return (
    <div style={styles.callContainer}>

      {/* Top bar */}
      <div style={styles.topBar}>
        <button onClick={onExit} style={styles.exitBtn}>← Exit</button>
        <div style={styles.personaBadge}>
          <span>{persona.emoji}</span>
          <span style={{ fontWeight: "bold" }}>{persona.name}</span>
          <span style={{ color: diff.color, fontSize: "0.75rem" }}>
            {DIFFICULTY_CONFIG[persona.difficulty].label}
          </span>
        </div>
        <div style={{ width: 60 }} /> {/* spacer */}
      </div>

      {/* Status */}
      <div style={{ ...styles.statusBadge, backgroundColor: statusColors[status] }}>
        {statusLabel}
      </div>

      {/* Hold button */}
      <button
        onMouseDown={() => { isRecordingRef.current = true; setStatus("listening"); }}
        onMouseUp={() => { isRecordingRef.current = false; socketRef.current?.sendEndOfSpeech(); setStatus("ready"); }}
        onMouseLeave={() => {
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
        <div style={styles.msgCard}>
          <p style={styles.msgLabel}>You said:</p>
          <p style={styles.msgText}>{transcript}</p>
        </div>
      )}

      {/* AI response */}
      {aiText && (
        <div style={{ ...styles.msgCard, ...styles.aiMsgCard }}>
          <p style={styles.msgLabel}>{persona.name}:</p>
          <p style={styles.msgText}>{aiText}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={styles.errorCard}><p>{error}</p></div>
      )}

      {/* Feedback overlay */}
      {feedback && (
        <div style={{
          ...styles.feedbackBadge,
          backgroundColor: feedbackBg[feedback.category] ?? "#1a1a1a",
          borderColor: feedbackBorder[feedback.category] ?? "#555",
          opacity: feedbackVisible ? 1 : 0,
          transform: feedbackVisible
            ? "translate(-50%, 0)"
            : "translate(-50%, 12px)",
        }}>
          <span style={{ fontSize: "1.1rem" }}>{feedback.icon}</span>
          <span style={{ color: "#fff" }}>{feedback.message}</span>
        </div>
      )}
    </div>
  );
}

// ─── Root Component ───────────────────────────────────────────────────────────
export default function VoiceChat() {
  const [selectedPersona, setSelectedPersona] = useState(null);

  if (!selectedPersona) {
    return <PersonaSelector onSelect={setSelectedPersona} />;
  }

  return (
    <CallScreen
      persona={selectedPersona}
      onExit={() => setSelectedPersona(null)}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  fullCenter: {
    display: "flex", alignItems: "center", justifyContent: "center",
    minHeight: "100vh", backgroundColor: "#0a0a0a",
  },
  selectorContainer: {
    minHeight: "100vh",
    backgroundColor: "#0a0a0a",
    padding: "3rem 2rem",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2.5rem",
  },
  selectorHeader: {
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  selectorTitle: {
    fontSize: "3rem",
    fontWeight: "900",
    color: "#fff",
    fontFamily: "Georgia, serif",
    letterSpacing: "0.05em",
    margin: 0,
  },
  selectorSubtitle: {
    fontSize: "1rem",
    color: "#888",
    fontFamily: "monospace",
    textTransform: "uppercase",
    letterSpacing: "0.2em",
    margin: 0,
  },
  selectorHint: {
    fontSize: "0.85rem",
    color: "#444",
    fontFamily: "monospace",
    margin: 0,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: "1.25rem",
    width: "100%",
    maxWidth: "1100px",
  },
  card: {
    border: "1px solid #222",
    borderRadius: "16px",
    padding: "1.75rem",
    cursor: "pointer",
    transition: "all 0.2s ease",
    display: "flex",
    flexDirection: "column",
    gap: "0.6rem",
  },
  cardEmoji: {
    fontSize: "2.5rem",
    lineHeight: 1,
  },
  diffBadge: {
    display: "inline-block",
    padding: "0.2rem 0.7rem",
    borderRadius: "999px",
    border: "1px solid",
    fontSize: "0.7rem",
    fontFamily: "monospace",
    fontWeight: "bold",
    letterSpacing: "0.1em",
    width: "fit-content",
    textTransform: "uppercase",
  },
  cardName: {
    fontSize: "1.25rem",
    fontWeight: "bold",
    color: "#fff",
    fontFamily: "Georgia, serif",
    margin: 0,
  },
  cardTitle: {
    fontSize: "0.8rem",
    color: "#666",
    fontFamily: "monospace",
    margin: 0,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
  },
  cardDesc: {
    fontSize: "0.875rem",
    color: "#aaa",
    fontFamily: "monospace",
    lineHeight: 1.6,
    margin: 0,
    flexGrow: 1,
  },
  cardFooter: {
    paddingTop: "0.5rem",
    borderTop: "1px solid #1a1a1a",
    fontFamily: "monospace",
  },

  // Call screen
  callContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minHeight: "100vh",
    backgroundColor: "#0a0a0a",
    color: "#fff",
    fontFamily: "monospace",
    padding: "1.5rem 2rem 4rem",
    gap: "1.5rem",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    maxWidth: "700px",
  },
  exitBtn: {
    background: "none",
    border: "1px solid #333",
    color: "#888",
    padding: "0.4rem 0.9rem",
    borderRadius: "8px",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.85rem",
  },
  personaBadge: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    fontSize: "0.9rem",
    color: "#ccc",
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
  msgCard: {
    background: "#111",
    border: "1px solid #222",
    borderRadius: "12px",
    padding: "1rem 1.5rem",
    maxWidth: "600px",
    width: "100%",
  },
  aiMsgCard: {
    borderColor: "#2a2a3a",
    background: "#13131f",
  },
  msgLabel: {
    fontSize: "0.7rem",
    color: "#555",
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    marginBottom: "0.4rem",
    margin: "0 0 0.4rem 0",
  },
  msgText: {
    fontSize: "1rem",
    lineHeight: "1.6",
    margin: 0,
    color: "#ddd",
  },
  errorCard: {
    background: "#1a0000",
    border: "1px solid #ff4444",
    borderRadius: "12px",
    padding: "1rem 1.5rem",
    color: "#ff4444",
    fontSize: "0.9rem",
    maxWidth: "600px",
    width: "100%",
  },
  feedbackBadge: {
    position: "fixed",
    bottom: "2rem",
    left: "50%",
    transform: "translate(-50%, 0)",
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.75rem 1.5rem",
    borderRadius: "999px",
    border: "1px solid",
    fontSize: "0.9rem",
    fontWeight: "bold",
    fontFamily: "monospace",
    transition: "opacity 0.4s ease, transform 0.4s ease",
    pointerEvents: "none",
    zIndex: 100,
    whiteSpace: "nowrap",
  },
};

const statusColors = {
  connecting: "#888",
  ready:      "#aaa",
  listening:  "#4ade80",
  ai_talking: "#60a5fa",
  error:      "#f87171",
};