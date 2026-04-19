// Reusable WebSocket connection manager
// Handles connection, message routing, and reconnection

export function createSocket({ onTranscript, onAIText, onAudio, onError }) {
  const socket = new WebSocket("ws://localhost:3001");
  socket.binaryType = "arraybuffer"; // important: receive audio as ArrayBuffer

  socket.onopen = () => {
    console.log("✅ Connected to SimuSales server");
  };

  socket.onmessage = async (event) => {
    // Binary = audio from ElevenLabs
    if (event.data instanceof ArrayBuffer) {
      onAudio && onAudio(event.data);
      return;
    }

    // Otherwise it's a JSON message (transcript, ai_text, error)
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === "transcript") {
        onTranscript && onTranscript(msg.text);
      } else if (msg.type === "ai_text") {
        onAIText && onAIText(msg.text);
      } else if (msg.type === "error") {
        onError && onError(msg.message);
      }
    } catch (err) {
      console.error("Failed to parse server message:", err);
    }
  };

  socket.onerror = (err) => {
    console.error("WebSocket error:", err);
    onError && onError("Connection error");
  };

  socket.onclose = () => {
    console.log("🔌 Disconnected from server");
  };

  // Helper to send audio chunks
  socket.sendAudio = (chunk) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(chunk);
    }
  };

  // Helper to signal end of speech
  socket.sendEndOfSpeech = () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send("END_OF_SPEECH");
    }
  };

  return socket;
}