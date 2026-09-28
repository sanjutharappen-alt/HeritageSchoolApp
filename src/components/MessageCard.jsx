import { useState, useRef, useEffect } from 'react'

// Auto-resizes to fit content on every render so the textarea never clips text.
function AutoTextarea({ value, onChange }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  })

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      className="w-full bg-navy-900 border border-navy-700 focus:border-gold-500 text-navy-100 text-xs rounded p-3 font-sans leading-relaxed resize-none overflow-hidden focus:outline-none"
      style={{ minHeight: '6rem' }}
    />
  )
}

export default function MessageCard({
  student,
  emailDraft,
  whatsappDraft,
  onEmailChange,
  onWhatsAppChange,
}) {
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState('email')
  const [copied, setCopied] = useState(false)

  const phone = (student['Contact No'] || '').replace(/\D/g, '')
  const waPhone = phone.length === 10 ? `91${phone}` : phone
  const hasPhone = !!phone
  const hasEmail = !!student['Email Address']

  const copy = () => {
    navigator.clipboard.writeText(tab === 'email' ? emailDraft : whatsappDraft)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const openWhatsApp = () => {
    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(whatsappDraft)}`, '_blank')
  }

  const openEmail = () => {
    const subjectMatch = emailDraft.match(/^Subject: ([^\n]+)\n\n/)
    const subject = subjectMatch ? subjectMatch[1].trim() : 'Fee Reminder — The Heritage School'
    const body = subjectMatch ? emailDraft.slice(subjectMatch[0].length) : emailDraft
    window.open(`mailto:${student['Email Address']}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)
  }

  return (
    <div className="border border-navy-700 rounded-lg overflow-hidden bg-navy-800">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-navy-700 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gold-500 flex items-center justify-center text-navy-900 font-bold text-sm">
            {(student['Student Name'] || student.studentName || '?')[0]}
          </div>
          <div>
            <p className="text-white font-medium text-sm">{student['Student Name'] || student.studentName}</p>
            <p className="text-navy-300 text-xs">{student['Email Address']} · {student['Contact No']}</p>
          </div>
        </div>
        <span className="text-navy-400 text-lg">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="border-t border-navy-700 p-4">
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setTab('email')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${tab === 'email' ? 'bg-gold-500 text-navy-900' : 'bg-navy-700 text-navy-300 hover:bg-navy-600'}`}
            >
              Email
            </button>
            <button
              onClick={() => setTab('whatsapp')}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${tab === 'whatsapp' ? 'bg-gold-500 text-navy-900' : 'bg-navy-700 text-navy-300 hover:bg-navy-600'}`}
            >
              WhatsApp
            </button>
            <span className="text-navy-500 text-xs self-center ml-1">Click to edit</span>
          </div>

          {tab === 'email' ? (
            <AutoTextarea
              value={emailDraft}
              onChange={e => onEmailChange?.(e.target.value)}
            />
          ) : (
            <AutoTextarea
              value={whatsappDraft}
              onChange={e => onWhatsAppChange?.(e.target.value)}
            />
          )}

          <div className="flex gap-2 flex-wrap mt-3">
            <button onClick={copy} className="px-3 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 text-white text-xs rounded transition-colors">
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            {hasEmail && (
              <button onClick={openEmail} className="px-3 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 text-white text-xs rounded transition-colors">
                ✉ Email
              </button>
            )}
            {hasPhone && (
              <button onClick={openWhatsApp} className="px-3 py-2 min-h-[44px] bg-green-700 hover:bg-green-600 text-white text-xs rounded transition-colors">
                WhatsApp
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
