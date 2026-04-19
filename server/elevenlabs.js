// ElevenLabs Text-to-Speech
// Returns an ArrayBuffer of audio data (mp3)

export async function textToSpeech(text) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!voiceId) {
    throw new Error("ELEVENLABS_VOICE_ID is not set in your .env file");
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2", // fastest model — best for real-time
        voice_settings: {
          stability: 0.4,        // slightly lower = more expressive/human
          similarity_boost: 0.8,
          style: 0.3,            // adds character/emotion
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs error: ${response.status} — ${errText}`);
  }

  return await response.arrayBuffer();
}