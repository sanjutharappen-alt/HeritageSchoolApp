const VOICES = {
  English: {
    Female: { languageCode: 'en-IN', name: 'en-IN-Wavenet-A' },
    Male:   { languageCode: 'en-IN', name: 'en-IN-Wavenet-B' },
  },
  Malayalam: {
    Female: { languageCode: 'ml-IN', name: 'ml-IN-Wavenet-A' },
    Male:   { languageCode: 'ml-IN', name: 'ml-IN-Wavenet-B' },
  },
}

export async function generateSpeech(text, language, gender, accessToken) {
  const voice = VOICES[language]?.[gender] ?? VOICES.English.Female
  console.log('[TTS] Generating speech | language:', language, '| gender:', gender, '| voice:', voice, '| text preview:', text.slice(0, 80))
  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { text },
      voice,
      audioConfig: { audioEncoding: 'MP3' },
    }),
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message || `Google TTS error ${res.status}`)
  }

  const { audioContent } = await res.json()
  const binary = atob(audioContent)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: 'audio/mpeg' })
  return URL.createObjectURL(blob)
}
