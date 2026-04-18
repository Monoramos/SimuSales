import { useEffect, useRef } from "react";

export default function VoiceChat() {
  const socketRef = useRef(null);
  const mediaRecorderRef = useRef(null);

  useEffect(() => {
    socketRef.current = new WebSocket("ws://localhost:3001");

    socketRef.current.onopen = () => {
      console.log("Connected to server");
    };

    // 🔥 ADD THIS BLOCK HERE
    socketRef.current.onmessage = async (event) => {
      const audioBlob = new Blob([event.data], { type: "audio/mpeg" });
      const audioUrl = URL.createObjectURL(audioBlob);

      const audio = new Audio(audioUrl);
      audio.play();
    };

    startMic();
  }, []);

  const startMic = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(event.data);
      }
    };

    mediaRecorder.start(250); // send chunks every 250ms
  };

  return <div>🎤 Talking...</div>;
}
