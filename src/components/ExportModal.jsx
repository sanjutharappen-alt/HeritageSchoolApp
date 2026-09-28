import { useState, useEffect } from 'react'
import { readSheet, parseSheetData } from '../utils/sheets'
import { sortBatches } from '../utils/batches'

const SOURCES = [
  { id: 'student',   label: 'StudentList',           sheetKey: 'student', range: 'Students!A:Z' },
  { id: 'fees',      label: 'FeeTracker — Fees',     sheetKey: 'fee',     range: 'Fees!A:G' },
  { id: 'transport', label: 'FeeTracker — Transport', sheetKey: 'fee',     range: 'Transport!A:G' },
  { id: 'log',       label: 'MessageLog',             sheetKey: 'log',     range: 'A:Z' },
]

function parseLogDate(str) {
  if (!str) return null
  const [datePart] = str.split(', ')
  const parts = datePart.split('/')
  if (parts.length !== 3) return null
  const [d, m, y] = parts
  return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`)
}

export default function ExportModal({ googleToken, studentSheetId, feeSheetId, logSheetId, onClose }) {
  const [sourceId, setSourceId] = useState('student')
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [selectedCols, setSelectedCols] = useState(new Set())
  const [batchFilter, setBatchFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [termFilter, setTermFilter] = useState('All')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  const source = SOURCES.find(s => s.id === sourceId)
  const sheetId = source.sheetKey === 'student' ? studentSheetId
    : source.sheetKey === 'fee' ? feeSheetId
    : logSheetId

  useEffect(() => { loadSheet() }, [sourceId])

  async function loadSheet() {
    setHeaders([])
    setRows([])
    setSelectedCols(new Set())
    setBatchFilter('All')
    setStatusFilter('All')
    setTermFilter('All')
    setDateFrom('')
    setDateTo('')
    setLoadError('')
    if (!sheetId) { setLoadError('Sheet ID not configured in Settings.'); return }
    if (!googleToken) { setLoadError('Connect Google Account first.'); return }
    setIsLoading(true)
    try {
      const values = await readSheet(sheetId, source.range, googleToken)
      const { headers: h, rows: r } = parseSheetData(values)
      setHeaders(h)
      setRows(r)
      setSelectedCols(new Set(h))
    } catch (e) {
      setLoadError(e.message)
    } finally {
      setIsLoading(false)
    }
  }

  const batches = sourceId === 'student'
    ? sortBatches([...new Set(rows.map(r => r['Batch Name']).filter(Boolean))])
    : sourceId === 'log'
    ? sortBatches([...new Set(rows.map(r => r['Batch']).filter(Boolean))])
    : []

  const terms = (sourceId === 'fees' || sourceId === 'transport')
    ? [...new Set(rows.map(r => r['Term']).filter(Boolean))].sort()
    : []

  function getFiltered() {
    return rows.filter(r => {
      if (sourceId === 'student' && batchFilter !== 'All' && r['Batch Name'] !== batchFilter) return false
      if ((sourceId === 'fees' || sourceId === 'transport') && statusFilter !== 'All' && r['Status'] !== statusFilter) return false
      if ((sourceId === 'fees' || sourceId === 'transport') && termFilter !== 'All' && r['Term'] !== termFilter) return false
      if (sourceId === 'log' && batchFilter !== 'All' && r['Batch'] !== batchFilter) return false
      if (sourceId === 'log' && dateFrom) {
        const d = parseLogDate(r['Date & Time'])
        if (!d || d < new Date(dateFrom)) return false
      }
      if (sourceId === 'log' && dateTo) {
        const d = parseLogDate(r['Date & Time'])
        if (!d || d > new Date(dateTo + 'T23:59:59')) return false
      }
      return true
    })
  }

  function exportCSV() {
    const filtered = getFiltered()
    const cols = headers.filter(h => selectedCols.has(h))
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [
      cols.map(esc).join(','),
      ...filtered.map(row => cols.map(c => esc(row[c])).join(','))
    ].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${source.label.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredCount = getFiltered().length

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 w-full max-w-lg space-y-5 max-h-[90vh] overflow-y-auto">

        <div className="flex items-center justify-between">
          <h2 className="text-white font-bold text-lg">Export Data</h2>
          <button onClick={onClose} className="text-navy-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Source selector */}
        <div>
          <p className="text-xs text-navy-400 mb-2">Data Source</p>
          <div className="grid grid-cols-2 gap-2">
            {SOURCES.map(s => (
              <button
                key={s.id}
                onClick={() => setSourceId(s.id)}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors text-left ${
                  sourceId === s.id
                    ? 'bg-gold-500 text-navy-900 border-gold-500'
                    : 'bg-navy-900 text-navy-300 border-navy-600 hover:border-navy-400'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-navy-400 text-sm">
            <span className="w-4 h-4 border-2 border-navy-400 border-t-transparent rounded-full animate-spin" />
            Reading sheet…
          </div>
        )}
        {loadError && <p className="text-red-400 text-sm">{loadError}</p>}

        {headers.length > 0 && (
          <>
            {/* Column selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-navy-400">Columns to export</p>
                <div className="flex gap-3">
                  <button onClick={() => setSelectedCols(new Set(headers))} className="text-xs text-gold-400 hover:text-gold-300">Select all</button>
                  <button onClick={() => setSelectedCols(new Set())} className="text-xs text-navy-500 hover:text-navy-300">Clear</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5 bg-navy-900 rounded-lg p-3">
                {headers.map(h => (
                  <label key={h} className="flex items-center gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={selectedCols.has(h)}
                      onChange={() => setSelectedCols(prev => {
                        const next = new Set(prev)
                        next.has(h) ? next.delete(h) : next.add(h)
                        return next
                      })}
                      className="accent-gold-400 w-3.5 h-3.5 flex-shrink-0"
                    />
                    <span className="text-xs text-navy-200 group-hover:text-white truncate">{h}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Filters */}
            <div className="space-y-3">
              {/* Batch — StudentList + MessageLog */}
              {batches.length > 0 && (
                <div>
                  <label className="block text-xs text-navy-400 mb-1">Batch</label>
                  <select
                    value={batchFilter}
                    onChange={e => setBatchFilter(e.target.value)}
                    className="w-full bg-navy-900 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500"
                  >
                    <option value="All">All Batches</option>
                    {batches.map(b => <option key={b}>{b}</option>)}
                  </select>
                </div>
              )}

              {/* Status + Term — FeeTracker */}
              {(sourceId === 'fees' || sourceId === 'transport') && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-navy-400 mb-1">Status</label>
                    <select
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value)}
                      className="w-full bg-navy-900 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500"
                    >
                      <option value="All">All</option>
                      <option>Paid</option>
                      <option>Unpaid</option>
                    </select>
                  </div>
                  {terms.length > 0 && (
                    <div className="flex-1">
                      <label className="block text-xs text-navy-400 mb-1">Term</label>
                      <select
                        value={termFilter}
                        onChange={e => setTermFilter(e.target.value)}
                        className="w-full bg-navy-900 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500"
                      >
                        <option value="All">All Terms</option>
                        {terms.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Date range — MessageLog */}
              {sourceId === 'log' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-navy-400 mb-1">From</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                      className="w-full bg-navy-900 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-navy-400 mb-1">To</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                      className="w-full bg-navy-900 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500" />
                  </div>
                </div>
              )}
            </div>

            {/* Export */}
            <div className="pt-1 space-y-2">
              <p className="text-xs text-navy-400">{filteredCount} rows · {selectedCols.size} columns selected</p>
              <button
                onClick={exportCSV}
                disabled={selectedCols.size === 0 || filteredCount === 0}
                className="w-full py-2.5 min-h-[44px] bg-gold-500 hover:bg-gold-400 active:bg-gold-600 disabled:opacity-50 disabled:cursor-not-allowed text-navy-900 font-bold rounded-lg text-sm transition-colors"
              >
                Export as CSV
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
