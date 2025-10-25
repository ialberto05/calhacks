// Negation AI – single-file backend (Express + Claude + Vapi webhook)
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const axios = require("axios");

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MODEL = process.env.MODEL || "claude-3-5-sonnet-20240620";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// System policy (Negation AI)
const SYSTEM_NEGAI = `
You are Negation AI, a calm, concise voice agent for sales & customer service.
Goals: detect intent; clarify+validate; offer a small next step; if pushed, offer an alternative; if still no, exit cleanly.
Keep replies 1–2 short sentences (TTS-friendly).
On "wrap_up", output ONLY compact JSON summary.
`.trim();

// DEV MODE: if no key, simulate replies so wiring works today
const DEV_MODE = !ANTHROPIC_KEY;

async function chatWithClaude(userText, systemText = SYSTEM_NEGAI) {
  if (DEV_MODE) {
    if (/cancel/i.test(userText)) {
      return "[DEV MODE] I can help with that. Would a one-month pause or a lighter plan work, or should I proceed to cancel?";
    }
    if (/expensive|price|budget/i.test(userText)) {
      return "[DEV MODE] Totally fair. Is it a budget cap or unclear value? We can start with a short pilot—want a 30-min demo Tue or Wed?";
    }
    return "[DEV MODE] Got it. Can I clarify your goal and suggest a small next step?";
  }

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": ANTHROPIC_KEY,
    "anthropic-version": "2023-06-01"
  };
  const body = {
    model: MODEL,
    max_tokens: 512,
    system: systemText,
    messages: [{ role: "user", content: userText }]
  };
  const { data } = await axios.post(ANTHROPIC_URL, body, { headers });
  const block = Array.isArray(data?.content)
    ? data.content.find(c => c.type === "text")
    : null;
  return block?.text ?? "";
}

// Health
app.get("/health", (_, res) => res.json({ ok: true, devMode: DEV_MODE }));

// Manual text test (frontend/teammates can call this)
app.post("/api/claude/chat", async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });
    const reply = await chatWithClaude(prompt);
    res.json({ reply, devMode: DEV_MODE });
  } catch (e) {
    console.error("Claude error:", e?.response?.data || e.message);
    res.status(500).json({ error: "Claude call failed" });
  }
});

// Vapi webhook: receives STT text, returns { reply } for TTS
app.post("/api/vapi/webhook", async (req, res) => {
  try {
    const event = req.body || {};
    const type = event.type || event.event || "unknown";

    if (type === "user_message" || type === "transcript" || type === "message") {
      const userText =
        event.text ||
        event.transcript ||
        event.message ||
        event.payload?.text ||
        "";
      if (!userText) return res.json({ reply: "Sorry, I didn’t catch that." });

      const reply = await chatWithClaude(userText);
      return res.json({ reply, devMode: DEV_MODE });
    }

    if (type === "wrap_up") {
      const transcript = event.transcript || "";
      const summary = await chatWithClaude(
        `wrap_up: create final JSON summary for this conversation transcript:\n${transcript}`
      );
      return res.json({ summary, devMode: DEV_MODE });
    }

    res.json({ ok: true, type, devMode: DEV_MODE });
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e.message);
    // keep 200 so Vapi doesn't retry spam
    return res.status(200).json({ reply: "Error handled.", devMode: DEV_MODE });
  }
});

app.listen(PORT, () =>
  console.log(
    `Negation AI backend running on :${PORT} ${DEV_MODE ? "(DEV MODE - no Claude key)" : ""}`
  )
);
