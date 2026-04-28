// Reusable WebSocket connection manager

export function createSocket({ personaKey, onTranscript, onAIText, onAudio, onFeedback, onSessionEnd, onError }) {
  const socket = new WebSocket(`wss://simusales-production.up.railway.app?persona=${personaKey}`);
  socket.binaryType = "arraybuffer";

  socket.onopen = () => {
    console.log(`✅ Connected — Persona: ${personaKey}`);
  };

  socket.onmessage = async (event) => {
    if (event.data instanceof ArrayBuffer) {
      onAudio && onAudio(event.data);
      return;
    }

    try {
      const msg = JSON.parse(event.data);

      if (msg.type === "transcript")   onTranscript && onTranscript(msg.text);
      else if (msg.type === "ai_text") onAIText && onAIText(msg.text);
      else if (msg.type === "feedback") onFeedback && onFeedback(msg);
      else if (msg.type === "session_end") onSessionEnd && onSessionEnd(msg);
      else if (msg.type === "error")   onError && onError(msg.message);
    } catch (err) {
      console.error("Failed to parse server message:", err);
    }
  };

  socket.onerror = (err) => {
    if (socket.readyState === WebSocket.OPEN) {
      console.error("WebSocket error:", err);
      onError && onError("Connection error");
    }
  };

  socket.onclose = () => {
    console.log("🔌 Disconnected from server");
  };

  socket.sendAudio = (chunk) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
  };

  socket.sendEndOfSpeech = () => {
    if (socket.readyState === WebSocket.OPEN) socket.send("END_OF_SPEECH");
  };

  // Signals the server to score and end the session
  socket.sendEndSession = () => {
    if (socket.readyState === WebSocket.OPEN) socket.send("END_SESSION");
  };

  socket.sendInterrupt = () => {
  if (socket.readyState === WebSocket.OPEN) socket.send("INTERRUPT");
  };  

  return socket;
}