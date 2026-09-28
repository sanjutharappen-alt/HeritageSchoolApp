import { useState, useMemo, useRef, useEffect } from 'react'
import { draftBroadcasts, generateLetter, translateTemplateToMalayalam } from '../utils/claude'
import { appendLogRow } from '../utils/sheets'
import { friendlyAnthropicError, isAuthError } from '../utils/errors'
import QuickTemplates from './QuickTemplates'
import VoicePlayer from './VoicePlayer'
import { sortBatches } from '../utils/batches'
import { SENDERS, DEFAULT_SENDER_LABEL, getSenderValue } from '../utils/senders'

const TONES = ['Formal', 'Friendly', 'Firm', 'Empathetic', 'Urgent']
const FORMATS = ['WhatsApp', 'Standard Letter', 'Detailed Letter']

export default function GeneralBroadcast({ studentData, dataLoaded: parentDataLoaded, anthropicKey, googleToken, logSheetId, onAuthError }) {
  const [batch, setBatch] = useState('All Batches')
  const [language, setLanguage] = useState('English')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [drafted, setDrafted] = useState([])
  const [isDrafting, setIsDrafting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)

  const [senderLabel, setSenderLabel] = useState(DEFAULT_SENDER_LABEL)
  const [draftSuccess, setDraftSuccess] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [broadcastCopySuccess, setBroadcastCopySuccess] = useState(false)
  const isSendingWA = useRef(false)
  const bodyRef = useRef(null)

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [body])

  // Generator panel state

  const [generatorOpen, setGeneratorOpen] = useState(false)
  const [commType, setCommType] = useState('')
  const [tone, setTone] = useState('Formal')
  const [format, setFormat] = useState('WhatsApp')
  const [keyPoints, setKeyPoints] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatorError, setGeneratorError] = useState('')
  const [preview, setPreview] = useState(null)

  const batches = useMemo(() => {
    const unique = [...new Set(studentData.map(s => s['Batch Name']).filter(Boolean))]
    return sortBatches(unique)
  }, [studentData])

  const recipients = useMemo(() => {
    if (batch === 'All Batches') return studentData
    return studentData.filter(s => s['Batch Name'] === batch)
  }, [studentData, batch])

  async function handleGenerate() {
    if (!commType.trim()) return setGeneratorError('Please enter a Communication Type.')
    if (!keyPoints.trim()) return setGeneratorError('Please enter the Key Points.')
    if (!anthropicKey) return setGeneratorError('Please enter your Anthropic API key in Settings.')
    setIsGenerating(true)
    setGeneratorError('')
    setPreview(null)
    try {
      const result = await generateLetter({ commType, tone, format, keyPoints, language }, anthropicKey)
      setPreview(result)
    } catch (e) {
      setGeneratorError(friendlyAnthropicError(e))
    } finally {
      setIsGenerating(false)
    }
  }

  function handleUseThis() {
    if (!preview) return
    setSubject(preview.subject || '')
    setBody(preview.body || '')
    setDrafted([])
    setGeneratorOpen(false)
  }

  function handleDraft() {
    if (!subject.trim() || !body.trim()) return setError('Please enter a subject and message body.')
    if (!recipients.length) return setError('No recipients found for selected batch.')
    setError('')
    setDrafted([])
    const results = draftBroadcasts(recipients, subject, body, getSenderValue(senderLabel), language)
    setDrafted(results.map((r, i) => ({ ...r, _student: recipients[i] })))
    setDraftSuccess(true)
    setTimeout(() => setDraftSuccess(false), 2000)
  }

  async function logMessage(channel) {
    if (!logSheetId || !googleToken) return
    try {
      await appendLogRow(logSheetId, [
        new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' }),
        senderLabel,
        'General Broadcast',
        batch,
        subject || '',
        body || '',
        recipients.length,
        channel,
      ], googleToken)
    } catch (e) { console.error('[MessageLog] logMessage error:', e) }
  }

  async function handleOpenGmailDraft() {
    const resolvedBody = (body || '').replace('The Heritage School Administration', getSenderValue(senderLabel))
    const greeting = language === 'Malayalam' ? 'പ്രിയ രക്ഷിതാവേ,' : 'Dear Parent,'
    const fullBody = resolvedBody.includes('{{GREETING}}')
      ? resolvedBody.replace('{{GREETING}}', greeting)
      : `${greeting}\n\n${resolvedBody}`
    const url = `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(fullBody)}`
    window.open(url, '_blank')
    await logMessage('Email')
  }

  async function handleWhatsAppAll(e) {
    e?.stopPropagation()
    if (isSendingWA.current) return
    isSendingWA.current = true
    setShowConfirm(false)
    let opened = 0, skipped = 0
    try {
      const messages = draftBroadcasts(recipients, subject, body, getSenderValue(senderLabel), language)
      for (let i = 0; i < recipients.length; i++) {
        const phone = (recipients[i]['Contact No'] || '').replace(/\D/g, '')
        if (!phone) { skipped++; continue }
        const waPhone = phone.length === 10 ? `91${phone}` : phone
        window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(messages[i].whatsapp)}`, '_blank')
        opened++
        await new Promise(r => setTimeout(r, 2000))
      }
      await logMessage('WhatsApp')
      if (skipped > 0) {
        setError(`Opened ${opened} WhatsApp chat${opened !== 1 ? 's' : ''}. Skipped ${skipped} — missing phone number.`)
      }
    } finally {
      isSendingWA.current = false
    }
  }

  function handleCopyBroadcast() {
    const resolvedBody = (body || '').replace('The Heritage School Administration', getSenderValue(senderLabel))
    const greeting = language === 'Malayalam' ? 'പ്രിയ രക്ഷിതാക്കളേ,' : 'Dear Parents,'
    const finalBody = resolvedBody.includes('{{GREETING}}')
      ? resolvedBody.replace('{{GREETING}}', greeting)
      : `${greeting}\n\n${resolvedBody}`
    navigator.clipboard.writeText(finalBody)
    setBroadcastCopySuccess(true)
    setTimeout(() => setBroadcastCopySuccess(false), 2000)
  }

  function handleCopyAllEmails() {
    const emails = recipients.map(s => s['Email Address']).filter(Boolean).join(', ')
    navigator.clipboard.writeText(emails)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

  if (!studentData.length) {
    return (
      <p className="text-navy-400 text-sm text-center py-12">
        {parentDataLoaded
          ? 'StudentList is empty — add students to the StudentList sheet to begin.'
          : 'Load student data first using the button above.'}
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs text-navy-400 mb-1">Batch</label>
          <select
            value={batch}
            onChange={e => { setBatch(e.target.value); setDrafted([]) }}
            className="bg-navy-800 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500"
          >
            <option>All Batches</option>
            {batches.map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-navy-400 mb-1">Language</label>
          <div className="flex rounded-lg overflow-hidden border border-navy-600">
            {['English', 'Malayalam'].map(lang => (
              <button
                key={lang}
                onClick={() => { setLanguage(lang); setDrafted([]); setPreview(null) }}
                className={`px-4 py-2 text-sm font-medium transition-colors ${language === lang ? 'bg-gold-500 text-navy-900' : 'bg-navy-800 text-navy-300 hover:bg-navy-700'}`}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-navy-400 mb-1">Sender</label>
          <select
            value={senderLabel}
            onChange={e => { setSenderLabel(e.target.value); setDrafted([]) }}
            className="bg-navy-800 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500"
          >
            {SENDERS.map(s => <option key={s.label} value={s.label}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Live preview */}
      <p className="text-sm text-navy-300">
        <span className="text-gold-400 font-semibold">{recipients.length}</span> parents will receive this message
      </p>

      {/* ── Quick Templates ── */}
      <QuickTemplates onUse={async (subject, body, template) => {
        setError('')
        if (language === 'Malayalam') {
          if (!anthropicKey) {
            setError('Add your Anthropic API key in Settings to generate Malayalam templates.')
            return
          }
          try {
            const result = await translateTemplateToMalayalam(template, anthropicKey)
            setSubject(result.subject || '')
            setBody(result.body || '')
            setDrafted([])
            setPreview(null)
          } catch (e) {
            setError(friendlyAnthropicError(e))
          }
        } else {
          setSubject(subject)
          setBody(body)
          setDrafted([])
          setPreview(null)
        }
      }} />

      {/* ── Generate Message Panel ── */}
      <div className="border border-navy-600 rounded-xl overflow-hidden">
        <button
          onClick={() => setGeneratorOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-3 bg-navy-800 hover:bg-navy-700 transition-colors"
        >
          <span className="text-gold-400 font-semibold text-sm">Generate Message with AI</span>
          <span className="text-navy-400 text-sm">{generatorOpen ? '▲ Collapse' : '▼ Expand'}</span>
        </button>

        {generatorOpen && (
          <div className="bg-navy-900 p-5 space-y-4">
            {generatorError && (
              <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-2 text-sm">{generatorError}</div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-navy-400 mb-1">Communication Type</label>
                <input
                  value={commType}
                  onChange={e => { setCommType(e.target.value); setPreview(null) }}
                  placeholder="e.g. Academic Update, Event Invitation…"
                  className="w-full bg-navy-800 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 placeholder-navy-500"
                />
              </div>
              <div>
                <label className="block text-xs text-navy-400 mb-1">Tone</label>
                <select
                  value={tone}
                  onChange={e => { setTone(e.target.value); setPreview(null) }}
                  className="w-full bg-navy-800 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500"
                >
                  {TONES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-navy-400 mb-2">Format</label>
              <div className="flex gap-2 flex-wrap">
                {FORMATS.map(f => (
                  <button
                    key={f}
                    onClick={() => { setFormat(f); setPreview(null) }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${format === f ? 'bg-gold-500 text-navy-900 border-gold-500' : 'bg-navy-800 text-navy-300 border-navy-600 hover:border-navy-400'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-navy-400 mb-1">Key Points</label>
              <textarea
                value={keyPoints}
                onChange={e => { setKeyPoints(e.target.value); setPreview(null) }}
                rows={4}
                placeholder="Summarise the main points the letter should cover…"
                className="w-full bg-navy-800 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 placeholder-navy-500 resize-none"
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="px-5 py-2 min-h-[44px] bg-gold-500 hover:bg-gold-400 active:bg-gold-600 disabled:opacity-50 disabled:cursor-not-allowed text-navy-900 font-semibold rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              {isGenerating
                ? <><span className="w-4 h-4 border-2 border-navy-900 border-t-transparent rounded-full animate-spin" />Generating…</>
                : 'Generate Letter'}
            </button>

            {/* Preview */}
            {preview && (
              <div className="border border-navy-600 rounded-lg overflow-hidden">
                <div className="bg-navy-800 px-4 py-2 flex items-center justify-between">
                  <span className="text-xs text-navy-400 font-medium uppercase tracking-wide">Preview</span>
                  <button
                    onClick={handleUseThis}
                    className="px-3 py-1 bg-gold-500 hover:bg-gold-400 text-navy-900 text-xs font-semibold rounded transition-colors"
                  >
                    Use This ↓
                  </button>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <p className="text-xs text-navy-500 mb-1">Subject</p>
                    <p className="text-white text-sm font-medium">{preview.subject}</p>
                  </div>
                  <div>
                    <p className="text-xs text-navy-500 mb-1">Body</p>
                    <pre className="text-navy-200 text-sm whitespace-pre-wrap font-sans leading-relaxed">{preview.body}</pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-navy-400 mb-1">Subject</label>
          <input
            value={subject}
            onChange={e => { setSubject(e.target.value); setDrafted([]) }}
            placeholder="e.g. Annual Day Celebration — The Heritage School"
            className="w-full bg-navy-800 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 placeholder-navy-500"
          />
        </div>
        <div>
          <label className="block text-xs text-navy-400 mb-1">Message Body</label>
          <textarea
            ref={bodyRef}
            value={body}
            onChange={e => { setBody(e.target.value); setDrafted([]) }}
            rows={5}
            placeholder="Write the core message here, or generate one above…"
            className="w-full bg-navy-800 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 placeholder-navy-500 resize-none overflow-hidden"
          />
        </div>
      </div>

      {/* Preview + actions + voice — visible as soon as body has content */}
      {body.trim() && (() => {
        const resolvedBody = (body || '').replace('The Heritage School Administration', getSenderValue(senderLabel))
        const hasMarker = resolvedBody.includes('{{GREETING}}')
        const greeting = language === 'Malayalam' ? 'പ്രിയ രക്ഷിതാവേ,' : 'Dear Parent,'
        const previewText = hasMarker
          ? resolvedBody.replace('{{GREETING}}', greeting)
          : `${greeting}\n\n${resolvedBody}`
        return (
          <div className="space-y-4">
            <p className="text-gold-400 font-semibold text-sm">
              {recipients.length} parents ready to receive this message
            </p>

            {/* Message preview */}
            <div className="border border-navy-600 rounded-xl overflow-hidden">
              <div className="bg-navy-800 px-4 py-2.5 flex items-center gap-2">
                <span className="text-xs font-semibold text-navy-400 uppercase tracking-wide">Message Preview</span>
                <span className="text-xs text-navy-500">(generic — personalised per recipient on send)</span>
              </div>
              <div className="divide-y divide-navy-700">
                <div className="p-4 space-y-1.5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-gold-400 uppercase tracking-wide">Email</span>
                    {subject && <span className="text-xs text-navy-400">· {subject}</span>}
                  </div>
                  <pre className="text-navy-200 text-sm whitespace-pre-wrap font-sans leading-relaxed">{previewText}</pre>
                </div>
                <div className="p-4 space-y-1.5">
                  <span className="text-xs font-semibold text-green-400 uppercase tracking-wide block mb-2">WhatsApp</span>
                  <pre className="text-navy-200 text-sm whitespace-pre-wrap font-sans leading-relaxed">{previewText}</pre>
                </div>
              </div>
            </div>

            {/* Voice Player */}
            <VoicePlayer
              text={previewText}
              language={language}
              googleToken={googleToken}
              label="Voice Message"
              onAuthError={onAuthError}
            />

            {/* Action buttons */}
            <div className="flex flex-wrap gap-3">
              <button onClick={handleCopyAllEmails} className="px-5 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 text-white font-medium rounded-lg text-sm transition-colors">
                {copySuccess ? '✓ Copied' : 'Copy All Emails'}
              </button>
              <button onClick={handleOpenGmailDraft} className="px-5 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 text-white font-medium rounded-lg text-sm transition-colors">
                Open Gmail Draft
              </button>
              <button type="button" onClick={e => { e.stopPropagation(); setShowConfirm(true) }} className="px-5 py-2 min-h-[44px] bg-green-800 hover:bg-green-700 active:bg-green-900 text-white font-medium rounded-lg text-sm transition-colors">
                WhatsApp All ({recipients.length})
              </button>
              <button onClick={handleCopyBroadcast} className="px-5 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 text-white font-medium rounded-lg text-sm transition-colors">
                {broadcastCopySuccess ? '✓ Copied!' : 'Copy for Broadcast'}
              </button>
            </div>

            {/* Secondary — Personalize & Draft individual cards */}
            <div className="pt-2 border-t border-navy-700">
              <p className="text-xs text-navy-500 mb-2">Generate individual personalised cards per student</p>
              <button
                onClick={handleDraft}
                disabled={!recipients.length}
                className="px-5 py-2 min-h-[44px] bg-navy-800 hover:bg-navy-700 active:bg-navy-600 disabled:opacity-50 disabled:cursor-not-allowed text-navy-300 font-medium rounded-lg text-sm transition-colors border border-navy-600"
              >
                {draftSuccess ? '✓ Personalised' : `Personalize & Draft — ${recipients.length} parents`}
              </button>
            </div>
          </div>
        )
      })()}

      {/* Confirm Dialog */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowConfirm(false)}>
          <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-semibold mb-2">Send WhatsApp to {recipients.length} parents?</h3>
            <p className="text-navy-300 text-sm mb-5">This will open {recipients.length} WhatsApp windows with a 2-second delay between each.</p>
            <div className="flex gap-3">
              <button type="button" onClick={handleWhatsAppAll} className="flex-1 min-h-[44px] py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm font-medium">Yes, Send All</button>
              <button type="button" onClick={e => { e.stopPropagation(); setShowConfirm(false) }} className="flex-1 min-h-[44px] py-2 bg-navy-700 hover:bg-navy-600 text-white rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
