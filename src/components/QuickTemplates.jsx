import { useState } from 'react'
import { TEMPLATES } from '../utils/templates'

export default function QuickTemplates({ onUse }) {
  const [lastUsed, setLastUsed] = useState(null)
  const [loadingId, setLoadingId] = useState(null)

  async function handleClick(t) {
    if (loadingId !== null) return
    setLoadingId(t.id)
    try {
      // onUse may be async (Malayalam path calls Anthropic). Both paths
      // share the same UX: spinner while waiting, then ✓ Filled tick.
      const result = onUse(t.subject, t.body, t)
      if (result && typeof result.then === 'function') await result
      setLastUsed(t.id)
      setTimeout(() => setLastUsed(null), 1500)
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-navy-400 font-semibold uppercase tracking-wide">Quick Templates</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {TEMPLATES.map(t => {
          const isLoading = loadingId === t.id
          const otherLoading = loadingId !== null && !isLoading
          return (
            <button
              key={t.id}
              onClick={() => handleClick(t)}
              disabled={loadingId !== null}
              className={`flex items-start gap-3 px-3 py-3 min-h-[44px] rounded-lg border text-left transition-colors ${
                isLoading || lastUsed === t.id
                  ? 'border-gold-500 bg-navy-700'
                  : 'border-navy-600 bg-navy-800 hover:border-navy-400 hover:bg-navy-700'
              } ${otherLoading ? 'opacity-50 cursor-not-allowed' : ''} ${isLoading ? 'cursor-wait' : ''}`}
            >
              <span className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 ${t.color}`}>
                {isLoading
                  ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : t.abbr}
              </span>
              <span className="min-w-0">
                <span className="block text-white text-xs font-medium leading-tight">
                  {isLoading ? 'Generating…' : lastUsed === t.id ? '✓ Filled' : t.title}
                </span>
                <span className="block text-navy-400 text-xs leading-tight mt-0.5">{t.description}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
