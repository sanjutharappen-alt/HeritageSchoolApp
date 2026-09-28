import { useState, useEffect, useRef } from 'react'
import { generateSpeech } from '../utils/tts'
import { friendlyTtsError, isAuthError } from '../utils/errors'

const VOICE_NAMES = {
  English:   { Female: 'en-IN-Wavenet-A', Male: 'en-IN-Wavenet-B' },
  Malayalam: { Female: 'ml-IN-Wavenet-A', Male: 'ml-IN-Wavenet-B' },
}

// Malayalam Unicode block: U+0D00–U+0D7F
function hasMalayalamScript(text) {
  return /[ഀ-ൿ]/.test(text)
}

export default function VoicePlayer({ text, language = 'English', googleToken, label = 'Voice Message', onAuthError }) {
  const [gender, setGender] = useState('Female')
  const [isGenerating, setIsGenerating] = useState(false)
  const [audioUrl, setAudioUrl] = useState(null)
  const [error, setError] = useState('')
  const currentUrlRef = useRef(null)

  const voiceName = VOICE_NAMES[language]?.[gender] ?? 'en-IN-Wavenet-A'
  const languageMismatch = language === 'Malayalam' && text?.trim() && !hasMalayalamScript(text)

  useEffect(() => () => { if (currentUrlRef.current) URL.revokeObjectURL(currentUrlRef.current) }, [])

  // Clear stale audio when text, language, or gender changes
  useEffect(() => {
    if (audioUrl) { URL.revokeObjectURL(audioUrl); setAudioUrl(null); setError('') }
  }, [text, language, gender])

  async function handleGenerate() {
    if (!googleToken) return setError('Connect your Google account first.')
    if (!text?.trim()) return setError('No message text to convert.')
    setIsGenerating(true)
    setError('')
    if (audioUrl) { URL.revokeObjectURL(audioUrl); setAudioUrl(null) }
    try {
      const url = await generateSpeech(text, language, gender, googleToken)
      currentUrlRef.current = url
      setAudioUrl(url)
    } catch (e) {
      if (isAuthError(e)) onAuthError?.()
      setError(friendlyTtsError(e))
    } finally {
      setIsGenerating(false)
    }
  }

  function handleDownload() {
    if (!audioUrl) return
    const a = document.createElement('a')
    a.href = audioUrl
    a.download = `${label.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0, 10)}.mp3`
    a.click()
  }

  return (
    <div className="border border-navy-600 rounded-xl p-4 space-y-3 bg-navy-900/50">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-navy-400 uppercase tracking-wide">{label}</span>
          {/* Gender toggle */}
          <div className="flex rounded-lg overflow-hidden border border-navy-600">
            {['Female', 'Male'].map(g => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  gender === g ? 'bg-gold-500 text-navy-900' : 'bg-navy-800 text-navy-400 hover:bg-navy-700'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
          {/* Active voice indicator */}
          <span className="text-xs text-navy-500 font-mono">{voiceName}</span>
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          className="flex items-center gap-2 px-4 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
        >
          {isGenerating
            ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Generating…</>
            : <>🎙 Generate Voice Message</>}
        </button>
      </div>

      {/* Language mismatch warning */}
      {languageMismatch && (
        <p className="text-amber-400 text-xs leading-relaxed">
          ⚠ The message body is in English. To generate a Malayalam voice message, write or generate the message in Malayalam first, then click Personalize &amp; Draft before generating voice.
        </p>
      )}

      {error && <p className="text-red-400 text-xs">{error}</p>}

      {audioUrl && (
        <div className="space-y-2">
          <audio controls src={audioUrl} className="w-full h-9" />
          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1.5 text-xs text-gold-400 hover:text-gold-300 transition-colors"
          >
            ↓ Download MP3
          </button>
        </div>
      )}
    </div>
  )
}
