export async function textToSpeech(text) {
  const response = await fetch(
    "https://api.elevenlabs.io/v1/text-to-speech/YOUR_VOICE_ID",
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
        },
      }),
    }
  );

  return await response.arrayBuffer();
}
