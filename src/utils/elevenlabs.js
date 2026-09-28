export async function generateSpeech(text, voiceId, apiKey) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })

  if (!res.ok) {
    let message = `ElevenLabs error ${res.status}`
    try {
      const err = await res.json()
      message = err.detail?.message || err.detail || message
    } catch {}
    throw new Error(message)
  }

  const blob = await res.blob()
  return URL.createObjectURL(blob)
}
