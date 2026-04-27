import "dotenv/config";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import OpenAI from "openai";
import rateLimit from "express-rate-limit";
import { textToSpeech } from "./elevenlabs.js";

const app = express();
app.use(cors());
app.use(express.json());

const server = app.listen(3001, () =>
  console.log("Server running on port 3001")
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Rate Limiting ---
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});
app.use(limiter);

const personasLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  message: { error: "Too many requests to /personas." },
});

// --- Session Limits ---
const MAX_EXCHANGES = 20;

// --- Persona System ---
const PERSONAS = {
  friendlyFrank: {
    name: "Friendly Frank",
    title: "Small Business Owner",
    difficulty: "easy",
    winnable: true,
    emoji: "😊",
    voiceId: "dtSEyYGNJqjrtBArPCVZ",
    description: "Open, warm, and genuinely curious. Responds to confidence and charisma. One good answer is all it takes.",
    prompt: `You are a friendly, open-minded small business owner who is genuinely curious about new products. 
You are polite, engaged, and easy to talk to. You ask clarifying questions out of genuine interest, not skepticism. 
You raise mild concerns like "How much does it cost?" or "How long does setup take?" but you're not resistant. 
You respond warmly and conversationally. You are NOT a pushover — you won't buy something that makes no sense — 
but you are receptive and genuinely open to being convinced.
IMPORTANT: If the sales rep gives even ONE clear, confident, and relevant answer that addresses your situation, 
you should show genuine interest and say something like "That actually sounds great — what are the next steps?" 
You can be won over by charisma and confidence alone, even without hard data. You trust people who seem to know what they're doing.
Never break character.`,
  },

  busyBarbara: {
    name: "Busy Barbara",
    title: "Senior Operations Manager",
    difficulty: "medium",
    winnable: true,
    emoji: "📱",
    voiceId: "wvk9Caj0nEx4l3I9LaR6",
    description: "Overwhelmed and wants you gone. One sharp, unexpected insight stops her cold and flips the call.",
    prompt: `You are a senior operations manager who is overwhelmed, distracted, and wants this call to end as fast as possible. 
You are not rude, just completely disinterested. You say things like "I'm really not the right person for this", 
"We're not looking at new vendors right now", "Can you just send me an email?" or "I've got a meeting in two minutes." 
You are actively trying to get off the call without being mean about it.
IMPORTANT: You can be won over by ONE single sharp, unexpected, or surprisingly relevant statement. 
If the sales rep says something that genuinely stops you — a specific insight about your industry, a striking statistic, 
or a perfectly timed reframe — you pause and say something like "Wait... say that again. That's actually interesting." 
From that point you become cautiously engaged. Charisma and confidence matter — you respond to energy as much as logic.
Until that moment, keep trying to end the call. Never break character.`,
  },

  skepticalCTO: {
    name: "Skeptical CTO",
    title: "Chief Technology Officer",
    difficulty: "hard",
    winnable: true,
    emoji: "💻",
    voiceId: process.env.ELEVENLABS_VOICE_ID,
    description: "Technical, sharp, and unimpressed by buzzwords. Needs three consecutive solid answers before he budges.",
    prompt: `You are a skeptical, highly technical CTO being cold-called by a sales rep. 
You are busy, mildly annoyed, and not easily impressed. You challenge claims with technical precision 
and push back hard on buzzwords. You raise objections like "We already have a solution for that", 
"How does this actually integrate with our stack?", or "I've heard this pitch before." 
You behave like a real human — you get distracted, sigh, ask sharp questions, and occasionally go off on tangents. 
Keep responses short and punchy. Never be helpful or warm. Never break character.
IMPORTANT: If the sales rep gives three consecutive compelling, specific, and data-backed answers to your objections, 
you may begin to show cautious interest — say something like "Okay, that's actually not terrible. Send me a one-pager." 
But never cave easily — make them earn every inch. Charisma alone won't move you — you need substance.`,
  },

  theAnalyst: {
    name: "The Analyst",
    title: "CFO & Former Consultant",
    difficulty: "hard",
    winnable: true,
    emoji: "📊",
    voiceId: "OUMCzFUTd0F4Q6lkLkco",
    description: "Cold and data-obsessed. Charisma actively annoys her. Only hard metrics and ROI move the needle.",
    prompt: `You are a data-driven CFO and former management consultant. You are completely unmoved by charm, 
enthusiasm, or anecdotes. You speak in numbers, percentages, and ROI. You ask things like 
"What's the payback period?", "Do you have a peer-reviewed study on that?", "What's your churn rate?", 
or "I need to see the unit economics before this conversation goes any further." 
You are not hostile — just purely analytical. Emotion and charisma have zero effect on you. 
You respond only to logic, data, and specificity. Keep responses clipped and precise. Never break character.
IMPORTANT: Only after three consecutive responses that include specific metrics, verifiable claims, or concrete ROI evidence 
will you begin to engage seriously. At that point say something like "Those numbers are defensible. 
I'd want to validate them independently, but I'm willing to schedule a formal review." 
Charisma, confidence, and energy will actively annoy you — call it out if the rep relies on it.`,
  },

  theWall: {
    name: "The Wall",
    title: "Endurance Mode",
    difficulty: "unwinnable",
    winnable: false,
    emoji: "💀",
    voiceId: "8s7FhQuwCMptPvCeDnKj",
    description: "Impossible to move. Calls out every tactic by name. Pure objection-handling stress test. You will not win.",
    prompt: `You are the ultimate adversarial sales prospect. You are cold, dismissive, and completely unmovable. 
No pitch will impress you. No data will satisfy you. No reframe will work on you. 
You have heard every sales tactic before and you call them out by name. 
You say things like "That's a classic foot-in-the-door technique", "You're just mirroring me", 
"I've heard the ROI pitch a hundred times", or "This call is over in 30 seconds if you don't say something new." 
You are not rude for the sake of it — you are simply impossible to move. You will NEVER show interest, 
NEVER agree to a next step, and NEVER break. This persona exists purely to stress-test objection handling. 
Keep responses short, cutting, and devastating. Never break character. Never capitulate under any circumstances.`,
  },
};

// --- Valid persona keys (input validation) ---
const VALID_PERSONA_KEYS = new Set(Object.keys(PERSONAS));

// --- REST endpoint: persona list ---
app.get("/personas", personasLimiter, (req, res) => {
  const list = Object.entries(PERSONAS).map(([key, p]) => ({
    key,
    name: p.name,
    title: p.title,
    difficulty: p.difficulty,
    winnable: p.winnable,
    emoji: p.emoji,
    description: p.description,
  }));
  res.json(list);
});

// --- Conversation Memory ---
function createConversationHistory(persona) {
  return [{ role: "system", content: persona.prompt }];
}

// --- Win Detection Phrases ---
// If AI response contains any of these, session is won
const WIN_SIGNALS = [
  "send me a one-pager",
  "send me a proposal",
  "what are the next steps",
  "next steps",
  "schedule a",
  "set up a meeting",
  "i'd want to validate",
  "willing to schedule",
  "formal review",
  "say that again",
  "that's actually interesting",
  "that actually sounds great",
  "sounds great",
  "send me a quote",
  "let's talk more",
  "tell me more",
  "you've got my attention",
];

function detectWin(aiResponse) {
  const lower = aiResponse.toLowerCase();
  return WIN_SIGNALS.some((signal) => lower.includes(signal));
}

// --- WebSocket Server ---
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost:3001");
  const personaKey = url.searchParams.get("persona") || "";

  if (!VALID_PERSONA_KEYS.has(personaKey)) {
    console.warn(`Invalid persona key received: "${personaKey}" — defaulting to skepticalCTO`);
  }

  const activePersona = VALID_PERSONA_KEYS.has(personaKey)
    ? PERSONAS[personaKey]
    : PERSONAS.skepticalCTO;

  console.log(`Client connected — Persona: ${activePersona.name} | Difficulty: ${activePersona.difficulty}`);

  const conversationHistory = createConversationHistory(activePersona);
  const sessionData = {
    exchanges: 0,        // total back-and-forth turns
    transcripts: [],     // all user statements for scoring
    won: false,
    ended: false,
  };

  let audioChunks = [];
  let silenceTimer = null;

  ws.on("message", async (data) => {
    // Client signals manual exit — score and end
    if (data.toString() === "END_SESSION") {
      if (!sessionData.ended) {
        sessionData.ended = true;
        const score = await scoreSession(sessionData, activePersona);
        ws.send(JSON.stringify({
          type: "session_end",
          result: "exited",
          persona: activePersona.name,
          ...score,
        }));
      }
      return;
    }

    if (data.toString() === "END_OF_SPEECH") {
      clearTimeout(silenceTimer);
      if (audioChunks.length > 0) {
        const chunks = [...audioChunks];
        audioChunks = [];
        await processAudio(ws, chunks, conversationHistory, activePersona, sessionData);
      }
      return;
    }

    audioChunks.push(data);

    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(async () => {
      if (audioChunks.length > 0) {
        const chunks = [...audioChunks];
        audioChunks = [];
        await processAudio(ws, chunks, conversationHistory, activePersona, sessionData);
      }
    }, 1500);
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    clearTimeout(silenceTimer);
  });

  ws.on("error", (err) => {
    if (ws.readyState === WebSocket.OPEN) {
      console.error("WebSocket error:", err);
    }
  });
});

// --- Core Pipeline ---
async function processAudio(ws, audioChunks, conversationHistory, activePersona, sessionData) {
  console.log(`processAudio called — exchanges: ${sessionData.exchanges}, ended: ${sessionData.ended}`);
  if (sessionData.ended) return;

  if (sessionData.exchanges >= MAX_EXCHANGES) {
    sessionData.ended = true;
    const score = await scoreSession(sessionData, activePersona);
    ws.send(JSON.stringify({
      type: "session_end",
      result: "limit_reached",
      persona: activePersona.name,
      ...score,
    }));
    return;
  }

  try {
    const audioBuffer = Buffer.concat(audioChunks);

    const transcript = await transcribeAudio(audioBuffer);
    if (!transcript || transcript.trim() === "") {
      console.log("Empty transcript, skipping.");
      return;
    }

    console.log("User said:", transcript);
    sessionData.transcripts.push(transcript);
    sessionData.exchanges++;

    ws.send(JSON.stringify({ type: "transcript", text: transcript }));

    conversationHistory.push({ role: "user", content: transcript });

    const [aiResponse, feedback] = await Promise.all([
      getPersonaResponse(conversationHistory),
      getFeedback(transcript, conversationHistory),
    ]);

    console.log(`${activePersona.name} says:`, aiResponse);
    console.log("💡 Feedback:", feedback);

    conversationHistory.push({ role: "assistant", content: aiResponse });

    ws.send(JSON.stringify({ type: "ai_text", text: aiResponse }));

    if (feedback) {
      ws.send(JSON.stringify({ type: "feedback", ...feedback }));
    }

    const audioData = await textToSpeech(aiResponse, activePersona.voiceId);
    ws.send(audioData);

    // --- Win detection (only for winnable personas) ---
    if (activePersona.winnable && detectWin(aiResponse) && !sessionData.ended) {
      sessionData.ended = true;
      sessionData.won = true;

      // Small delay so audio plays before end screen
      setTimeout(async () => {
        const score = await scoreSession(sessionData, activePersona);
        ws.send(JSON.stringify({
          type: "session_end",
          result: "won",
          persona: activePersona.name,
          ...score,
        }));
      }, 3000);
    }
  } catch (err) {
    console.error("Pipeline error:", err);
    ws.send(JSON.stringify({ type: "error", message: err.message }));
  }
}

// --- Scoring Engine ---
async function scoreSession(sessionData, activePersona) {
  const { transcripts, exchanges, won } = sessionData;

  if (transcripts.length === 0) {
    return {
      overall: 0,
      breakdown: {
        objectionHandling: 0,
        questionQuality: 0,
        conciseness: 0,
        adaptability: 0,
      },
      summary: "No exchanges to score.",
      exchanges,
    };
  }

  // The Wall uses endurance scoring
  if (!activePersona.winnable) {
    return scoreEndurance(exchanges);
  }

  const fullConversation = transcripts.join("\n");

  const scoringPrompt = `You are an expert sales coach scoring a completed sales training session.

Persona faced: ${activePersona.name} (${activePersona.difficulty} difficulty)
Result: ${won ? "Won — prospect agreed to next steps" : "Exited early"}
Total exchanges: ${exchanges}

Sales rep's statements (in order):
${transcripts.map((t, i) => `${i + 1}. "${t}"`).join("\n")}

Score the sales rep across these 4 categories, each out of 25 points:

1. Objection Handling (25pts) — Did they address pushback directly and effectively?
2. Question Quality (25pts) — Did they ask smart discovery questions?
3. Conciseness (25pts) — Did they stay tight and focused, or ramble?
4. Adaptability (25pts) — Did they adjust their approach when the prospect pushed back?

Also write a 2-sentence coaching summary — what they did well and one thing to improve.

Return ONLY raw JSON, no markdown, no code fences:
{
  "objectionHandling": <0-25>,
  "questionQuality": <0-25>,
  "conciseness": <0-25>,
  "adaptability": <0-25>,
  "summary": "two sentence coaching summary here"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: scoringPrompt }],
      max_tokens: 200,
      temperature: 0.3,
    });

    const raw = response.choices[0].message.content
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "");

    const parsed = JSON.parse(raw);
    const overall = parsed.objectionHandling + parsed.questionQuality +
                    parsed.conciseness + parsed.adaptability;

    return {
      overall,
      breakdown: {
        objectionHandling: parsed.objectionHandling,
        questionQuality: parsed.questionQuality,
        conciseness: parsed.conciseness,
        adaptability: parsed.adaptability,
      },
      summary: parsed.summary,
      exchanges,
    };
  } catch (err) {
    console.error("Scoring error:", err);
    return {
      overall: 0,
      breakdown: { objectionHandling: 0, questionQuality: 0, conciseness: 0, adaptability: 0 },
      summary: "Scoring unavailable.",
      exchanges,
    };
  }
}

// --- Endurance Scoring for The Wall ---
function scoreEndurance(exchanges) {
  // Score based on exchanges survived — max 100 at 20+ exchanges
  const enduranceScore = Math.min(100, Math.round((exchanges / 20) * 100));
  const tier =
    exchanges >= 20 ? "Elite — you outlasted The Wall." :
    exchanges >= 15 ? "Strong — very few last this long." :
    exchanges >= 10 ? "Solid — you held your ground." :
    exchanges >= 5  ? "Getting there — keep pushing." :
                      "Early exit — The Wall wins this round.";

  return {
    overall: enduranceScore,
    breakdown: {
      objectionHandling: Math.min(25, Math.round((exchanges / 20) * 25)),
      questionQuality: Math.min(25, Math.round((exchanges / 20) * 25)),
      conciseness: Math.min(25, Math.round((exchanges / 20) * 25)),
      adaptability: Math.min(25, Math.round((exchanges / 20) * 25)),
    },
    summary: `${tier} You survived ${exchanges} exchange${exchanges !== 1 ? "s" : ""} against The Wall.`,
    exchanges,
    enduranceMode: true,
  };
}

// --- OpenAI Whisper: Speech to Text ---
async function transcribeAudio(audioBuffer) {
  const { toFile } = await import("openai");
  
  // Send as mp4 — Whisper accepts webm data labeled as mp4 was orginally using ffmpeg
  const audioFile = await toFile(audioBuffer, "audio.mp4", {
    type: "audio/mp4",
  });

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
    max_tokens: 150,
    temperature: 0.9,
  });

  return response.choices[0].message.content;
}

// --- Live Feedback / Sales Coach ---
async function getFeedback(transcript, conversationHistory) {
  const conversationSummary = conversationHistory
    .filter((m) => m.role !== "system")
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Sales rep" : "Prospect"}: ${m.content}`)
    .join("\n");

  const coachPrompt = `You are an expert sales coach analyzing a live sales call.

Recent conversation:
${conversationSummary}

Sales rep's latest statement: "${transcript}"

Analyze ONLY the sales rep's latest statement and return a single piece of coaching feedback as JSON.
Choose the single most important issue or praise. Be direct and specific — max 8 words for the message.

Return ONLY raw JSON with no markdown, no code fences, no backticks — just the JSON object itself:
{
  "category": "warning" | "tip" | "praise",
  "icon": "⚠️" | "💡" | "✅",
  "message": "short coaching message here"
}

Categories:
- "warning" (icon ⚠️): rambling, no questions, weak objection handling, feature dumping, losing control
- "tip" (icon 💡): missed opportunity, could ask a question, try reframing
- "praise" (icon ✅): good question asked, strong rebuttal, good listening, concise answer

If the statement is genuinely solid with no issues, return praise. Always return something.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: coachPrompt }],
      max_tokens: 80,
      temperature: 0.4,
    });

    const raw = response.choices[0].message.content
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "");

    return JSON.parse(raw);
  } catch (err) {
    console.error("Feedback parsing error:", err);
    return null;
  }
}