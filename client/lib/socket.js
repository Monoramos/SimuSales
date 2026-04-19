// Reusable WebSocket connection manager
// Accepts a persona key and passes it to the server as a query param

export function createSocket({ personaKey, onTranscript, onAIText, onAudio, onFeedback, onError }) {
  const socket = new WebSocket(`ws://localhost:3001?persona=${personaKey}`);
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

      if (msg.type === "transcript") {
        onTranscript && onTranscript(msg.text);
      } else if (msg.type === "ai_text") {
        onAIText && onAIText(msg.text);
      } else if (msg.type === "feedback") {
        onFeedback && onFeedback(msg);
      } else if (msg.type === "error") {
        onError && onError(msg.message);
      }
    } catch (err) {
      console.error("Failed to parse server message:", err);
    }
  };

  socket.onerror = (err) => {
  // Ignore transient errors during initial connection handshake
    if (socket.readyState === WebSocket.OPEN) {
      console.error("WebSocket error:", err);
      onError && onError("Connection error");
    }
  };

  socket.onclose = () => {
    console.log("🔌 Disconnected from server");
  };

  socket.sendAudio = (chunk) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(chunk);
    }
  };

  socket.sendEndOfSpeech = () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send("END_OF_SPEECH");
    }
  };

  return socket;
}