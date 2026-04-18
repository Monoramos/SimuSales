import express from "express";
import { WebSocketServer } from "ws";
import { WebSocketServer } from "./elevenlabs.js"

const app = express();
const server = app.listen(3001, () =>
  console.log("Server running on port 3001")
);

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (audioChunk) => {
    console.log("Received audio chunk:", audioChunk.byteLength);
  });
});
