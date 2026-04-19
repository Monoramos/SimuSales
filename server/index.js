import "dotenv/config";
import express from "express";
import { WebSocketServer } from "ws";
import OpenAI from "openai";
import { textToSpeech } from "./elevenlabs.js";
import { exec } from "child_process";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const app = express();
const server = app.listen(3001, () =>
  console.log("Server running on port 3001")
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Persona System ---
// Swap out ACTIVE_PERSONA to change who the AI is roleplaying
const PERSONAS = {
  skepticalCTO: {
    name: "Skeptical CTO",
    prompt: `You are a skeptical, highly technical CTO being cold-called by a sales rep. 
You are busy, mildly annoyed, and not easily impressed. You interrupt often, challenge claims with technical precision, 
and push back hard on buzzwords. You raise objections like "We already have a solution for that", 
"How does this actually integrate with our stack?", or "I've heard this pitch before." 
You behave like a real human — you get distracted, sigh, ask sharp questions, and occasionally go off on tangents. 
Keep responses short and punchy. Never be helpful or warm. Never break character.`,
  },
  impatientBuyer: {
    name: "Impatient Buyer",
    prompt: `You are an impatient, time-pressured procurement buyer. You have 3 minutes max for this call. 
You cut people off, ask "get to the point" constantly, and care only about price and delivery timeline. 
You're not interested in features — just cost and speed. You frequently say things like "I have another call in 2 minutes" 
or "Just tell me the price." Keep your responses very short. Never be warm or encouraging. Never break character.`,
  },
  priceSensitiveCustomer: {
    name: "Price-Sensitive Customer",
    prompt: `You are a small business owner who is very price-sensitive and skeptical of hidden costs. 
You've been burned by SaaS pricing before. You compare everything to cheaper alternatives. 
You say things like "Can't I just use [cheaper tool] for that?", "What happens if I cancel?", or "That sounds expensive." 
You're not hostile, just cautious and value-focused. Keep responses conversational and grounded. Never break character.`,
  },
  distractedExecutive: {
    name: "Distracted Executive",
    prompt: `You are a C-suite executive half-paying attention on this call. You're reading emails, 
occasionally responding to your assistant off-mic, and only catching every other sentence. 
You ask the sales rep to repeat things, go on brief tangents, and sometimes give non-sequitur responses. 
You're not rude — just genuinely distracted. Keep responses short. Occasionally say things like 
"Sorry, what was that?" or "Hold on one sec." Never break character.`,
  },
};

const ACTIVE_PERSONA = PERSONAS.skepticalCTO; // 👈 Change this to switch personas

// --- Conversation Memory ---
// Holds the rolling conversation history per connected client
function createConversationHistory() {
  return [
    {
      role: "system",
      content: ACTIVE_PERSONA.prompt,
    },
  ];
}

// --- WebSocket Server ---
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log(`Client connected — Persona: ${ACTIVE_PERSONA.name}`);

  // Each client gets its own conversation history
  const conversationHistory = createConversationHistory();

  // Buffer to accumulate audio chunks from the client
  let audioChunks = [];
  let silenceTimer = null;

  ws.on("message", async (data) => {
  console.log("📨 Received:", data.length ?? data.byteLength, "bytes");

  if (data.toString() === "END_OF_SPEECH") {
    clearTimeout(silenceTimer); // cancel timer BEFORE processing
    if (audioChunks.length > 0) {
      const chunks = [...audioChunks]; // snapshot
      audioChunks = []; // clear immediately so timer can't reuse them
      await processAudio(ws, chunks, conversationHistory);
    }
    return;
  }

  audioChunks.push(data);

  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(async () => {
    if (audioChunks.length > 0) {
      const chunks = [...audioChunks]; // snapshot
      audioChunks = []; // clear immediately so END_OF_SPEECH can't reuse them
      await processAudio(ws, chunks, conversationHistory);
    }
  }, 1500);
  });
});

// --- Core Pipeline: Audio → STT → AI → TTS → Client ---
async function processAudio(ws, audioChunks, conversationHistory) {
  try {
    console.log("🎙️ Processing audio, chunks:", audioChunks.length);
    // 1. Combine audio chunks into a single buffer
    const audioBuffer = Buffer.concat(audioChunks);
    console.log("📦 Buffer size:", audioBuffer.byteLength);


    // 2. Transcribe with OpenAI Whisper (STT)
    const transcript = await transcribeAudio(audioBuffer);
    console.log("📝 Transcript:", transcript);
    if (!transcript || transcript.trim() === "") {
      console.log("Empty transcript, skipping.");
      return;
    }

    console.log("User said:", transcript);

    // Send transcript back to client for display
    ws.send(JSON.stringify({ type: "transcript", text: transcript }));

    // 3. Add user message to conversation history
    conversationHistory.push({ role: "user", content: transcript });

    // 4. Get AI persona response
    const aiResponse = await getPersonaResponse(conversationHistory);
    console.log(`${ACTIVE_PERSONA.name} says:`, aiResponse);

    // Add AI response to history
    conversationHistory.push({ role: "assistant", content: aiResponse });

    // Send AI text to client for display + live feedback
    ws.send(JSON.stringify({ type: "ai_text", text: aiResponse }));

    // 5. Convert AI response to speech via ElevenLabs
    const audioData = await textToSpeech(aiResponse);

    // 6. Send audio back to client as binary
    ws.send(audioData);
  } catch (err) {
    console.error("Pipeline error:", err);
    ws.send(JSON.stringify({ type: "error", message: err.message }));
  }
}

// --- OpenAI Whisper: Speech to Text ---
async function transcribeAudio(audioBuffer) {
  // Write buffer to a temp webm file
  const inputPath = join(tmpdir(), `input_${Date.now()}.webm`);
  const outputPath = join(tmpdir(), `output_${Date.now()}.wav`);

  await writeFile(inputPath, audioBuffer);

  // Convert webm → wav using ffmpeg
  await new Promise((resolve, reject) => {
    exec(`ffmpeg -y -i ${inputPath} ${outputPath}`, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const wavBuffer = await readFile(outputPath);

  // Clean up temp files
  await unlink(inputPath).catch(() => {});
  await unlink(outputPath).catch(() => {});

  const { toFile } = await import("openai");
  const audioFile = await toFile(wavBuffer, "audio.wav", { type: "audio/wav" });

  const response = await openai.audio.transcriptions.create({
    file: audioFile,
    model: "whisper-1",
    language: "en",
  });

  return response.text;
}

// --- OpenAI GPT-4: Persona Response ---
async function getPersonaResponse(conversationHistory) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: conversationHistory,
    max_tokens: 150,      // Keep responses short and punchy — like real conversation
    temperature: 0.9,     // Higher = more unpredictable/human-like
  });

  return response.choices[0].message.content;
}