import { useState, useMemo, useRef, useEffect } from 'react'
import { readSheet, parseSheetData, writeStatusColumn, writeCellValues, colIndexToLetter, colLetterFromHeaders, appendLogRow } from '../utils/sheets'
import { createGmailDraft } from '../utils/gmail'
import { draftFeeReminders, draftTransportReminders } from '../utils/claude'
import { isAuthError, friendlySheetsError, friendlyGmailError } from '../utils/errors'
import MessageCard from './MessageCard'
import VoicePlayer from './VoicePlayer'
import { sortBatches } from '../utils/batches'
import { SENDERS, DEFAULT_SENDER_LABEL, getSenderValue } from '../utils/senders'

export default function FeeReminders({ studentData, dataLoaded: parentDataLoaded, feeSheetId, googleToken, logSheetId, onAuthError }) {
  const [selectedTab, setSelectedTab] = useState('Fees')
  const [transportTerm, setTransportTerm] = useState('I')
  const [feeHeaders, setFeeHeaders] = useState([])
  const [merged, setMerged] = useState([])
  const [paidMap, setPaidMap] = useState({})
  const [batchFilter, setBatchFilter] = useState('All Batches')
  const [drafted, setDrafted] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [isWriting, setIsWriting] = useState(false)
  const [error, setError] = useState('')
  const [writeSuccess, setWriteSuccess] = useState(false)
  const [draftSuccess, setDraftSuccess] = useState(false)
  const [broadcastCopySuccess, setBroadcastCopySuccess] = useState(false)
  const [isDraftingGmail, setIsDraftingGmail] = useState(false)
  const [gmailDraftResult, setGmailDraftResult] = useState(null)
  const [copyEmailsSuccess, setCopyEmailsSuccess] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [senderLabel, setSenderLabel] = useState(DEFAULT_SENDER_LABEL)

  const masterCheckboxRef = useRef(null)
  const isSendingWA = useRef(false)

  const isTransport = selectedTab === 'Transport'
  const txAmountCol = `TERM ${transportTerm}`
  const txStatusCol = `TERM ${transportTerm} Status`
  const txRemindersCol = `TERM ${transportTerm} Reminders`
  const TRANSPORT_REQUIRED_COLS = ['TERM I Status', 'TERM II Status', 'TERM III Status', 'TERM I Reminders', 'TERM II Reminders', 'TERM III Reminders']

  function rowDisplayName(row) {
    if (isTransport) {
      return row['Student Name'] || `${row._student?.['First Name'] || ''} ${row._student?.['Last Name'] || ''}`.replace(/\s+/g, ' ').trim()
    }
    return `${row._student['First Name']} ${row._student['Last Name']}`.replace(/\s+/g, ' ').trim()
  }
  function rowBatch(row) {
    return isTransport ? (row['Standard'] || '') : (row._student['Batch Name'] || '')
  }
  function rowAmount(row) { return isTransport ? (row[txAmountCol] || '') : (row['Amount Due'] || '') }
  function rowReminderCount(row) { return isTransport ? (row[txRemindersCol] || '0') : (row['Reminder Count'] || '0') }

  // Unique batch names from loaded data
  const batches = useMemo(() => {
    const unique = [...new Set(merged.map(rowBatch).filter(Boolean))]
    return sortBatches(unique)
  }, [merged, isTransport])

  // Rows currently visible after batch filter (and, for Transport, only rows with an amount for the selected term).
  const visibleRows = useMemo(() => {
    let out = merged
    if (isTransport) out = out.filter(r => (r[txAmountCol] || '').trim())
    if (batchFilter !== 'All Batches') out = out.filter(r => rowBatch(r) === batchFilter)
    return out
  }, [merged, batchFilter, isTransport, txAmountCol])

  // Unpaid = visible rows where checkbox is unchecked
  const visibleUnpaid = visibleRows.filter(r => !paidMap[r._rowIndex])
  const visiblePaid = visibleRows.length - visibleUnpaid.length

  // Master checkbox state: all paid = checked, none paid = unchecked, mixed = indeterminate
  const allChecked = visibleRows.length > 0 && visibleUnpaid.length === 0
  const someChecked = visiblePaid > 0 && visibleUnpaid.length > 0

  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = someChecked
    }
  }, [someChecked])

  function toggleAll() {
    const newValue = !allChecked
    setPaidMap(prev => {
      const next = { ...prev }
      visibleRows.forEach(r => { next[r._rowIndex] = newValue })
      return next
    })
    setDrafted([])
  }

  async function loadFeeData(tab = selectedTab) {
    if (!feeSheetId || !googleToken) return setError('Sheet ID or Google connection missing.')
    setIsLoading(true)
    setError('')
    setDrafted([])
    setMerged([])
    setBatchFilter('All Batches')
    try {
      const values = await readSheet(feeSheetId, `${tab}!A:G`, googleToken)
      let { headers, rows } = parseSheetData(values)

      // For Transport: ensure per-term Status/Reminders columns exist past the
      // visible A:G range; auto-append to the header row. paidMap stays
      // in-memory (defaults to all-paid each load), so we don't re-read.
      if (tab === 'Transport' && headers.length) {
        const missing = TRANSPORT_REQUIRED_COLS.filter(c => !headers.includes(c))
        if (missing.length) {
          const startCol = headers.length + 1
          const cells = missing.map((name, i) => ({
            colLetter: colIndexToLetter(startCol + i),
            rowIndex: 1,
            value: name,
          }))
          await writeCellValues(feeSheetId, tab, cells, googleToken)
          headers = [...headers, ...missing]
        }
      }
      setFeeHeaders(headers)

      // Both tabs match by Admission No. (column A in each sheet).
      const studentMap = {}
      studentData.forEach(s => { studentMap[s['Admission No.']] = s })

      // A row is "real" if any column other than the ID column has content.
      const mergedRows = rows
        .map(row => ({ ...row, _student: studentMap[row['Admission No.']] }))
        .filter(row => row._student)
        .filter(row => headers.some(h => h !== 'Admission No.' && (row[h] || '').trim()))

      setMerged(mergedRows)

      const initialPaid = {}
      mergedRows.forEach(row => { initialPaid[row._rowIndex] = true })
      setPaidMap(initialPaid)
      setLoaded(true)
    } catch (e) {
      if (isAuthError(e)) onAuthError?.()
      setError(friendlySheetsError(e))
    } finally {
      setIsLoading(false)
    }
  }

  function handleTabChange(tab) {
    setSelectedTab(tab)
    setMerged([])
    setDrafted([])
    setPaidMap({})
    setBatchFilter('All Batches')
    setLoaded(false)
    setError('')
  }

  function handleTermChange(term) {
    setTransportTerm(term)
    setDrafted([])
    // Reset paid state — per-term status is tracked independently.
    setPaidMap(prev => {
      const next = {}
      merged.forEach(r => { next[r._rowIndex] = true })
      return next
    })
  }

  function togglePaid(rowIndex) {
    setPaidMap(prev => ({ ...prev, [rowIndex]: !prev[rowIndex] }))
    setDrafted([])
  }

  function reminderLabel(count) {
    if (count <= 1) return 'This is Reminder 1'
    if (count === 2) return 'This is Reminder 2'
    if (count === 3) return 'This is Reminder 3'
    return 'This is your Final Reminder'
  }

  function reminderNumber(count) {
    if (count <= 1) return '1'
    if (count === 2) return '2'
    if (count === 3) return '3'
    return 'Final'
  }

  function handleDraft() {
    if (!visibleUnpaid.length) return setError('No unpaid students in the current view.')
    setError('')
    try {
      const newCounts = visibleUnpaid.map(row => {
        const current = parseInt(rowReminderCount(row), 10)
        return isNaN(current) ? 1 : current + 1
      })

      let results
      if (isTransport) {
        const input = visibleUnpaid.map((row, i) => ({
          studentName: rowDisplayName(row),
          standard: rowBatch(row),
          fathersName: (row['Fathers Name'] || '').trim(),
          amountDue: rowAmount(row),
          term: transportTerm,
          reminderLabel: reminderLabel(newCounts[i]),
          reminderNumber: reminderNumber(newCounts[i]),
        }))
        results = draftTransportReminders(input, getSenderValue(senderLabel))
      } else {
        const input = visibleUnpaid.map((row, i) => ({
          studentName: rowDisplayName(row),
          batchName: rowBatch(row),
          feeType: row['Fee Type'] || '',
          amountDue: rowAmount(row),
          dueDate: row['Due Date'] || '',
          term: row['Term'] || '',
          reminderLabel: reminderLabel(newCounts[i]),
          reminderNumber: reminderNumber(newCounts[i]),
        }))
        results = draftFeeReminders(input, getSenderValue(senderLabel))
      }

      setDrafted(results.map((r, i) => ({
        ...r,
        _student: visibleUnpaid[i]._student,
        _row: visibleUnpaid[i],
        _newCount: newCounts[i],
        _displayName: rowDisplayName(visibleUnpaid[i]),
      })))
      setDraftSuccess(true)
      setTimeout(() => setDraftSuccess(false), 2000)
    } catch (e) {
      setError(e.message)
    }
  }

  function handleCopyAllEmails() {
    const emails = visibleUnpaid.map(r => r._student['Email Address']).filter(Boolean).join(', ')
    navigator.clipboard.writeText(emails)
    setCopyEmailsSuccess(true)
    setTimeout(() => setCopyEmailsSuccess(false), 2000)
  }

  function handleCopyBroadcast() {
    if (!drafted.length) return
    const text = drafted[0].whatsapp.replace(/^Dear Parent,/, 'Dear Parents,')
    navigator.clipboard.writeText(text)
    setBroadcastCopySuccess(true)
    setTimeout(() => setBroadcastCopySuccess(false), 2000)
  }

  async function handleWriteStatus() {
    if (!googleToken) return setError('Please connect your Google account.')
    setIsWriting(true)
    setError('')
    try {
      const statusMap = {}
      merged.forEach(row => { statusMap[row._rowIndex] = paidMap[row._rowIndex] ? 'Paid' : 'Unpaid' })
      const statusColName = isTransport ? txStatusCol : 'Status'
      await writeStatusColumn(feeSheetId, selectedTab, merged, statusMap, feeHeaders, googleToken, statusColName)
      setWriteSuccess(true)
      setTimeout(() => setWriteSuccess(false), 3000)
    } catch (e) {
      if (isAuthError(e)) onAuthError?.()
      setError(friendlySheetsError(e))
    } finally {
      setIsWriting(false)
    }
  }

  async function writeReminderCounts() {
    const rcCol = isTransport ? txRemindersCol : 'Reminder Count'
    const rcColLetter = colLetterFromHeaders(feeHeaders, rcCol)
    if (!rcColLetter) return
    const cells = drafted.map(d => ({ colLetter: rcColLetter, rowIndex: d._row._rowIndex, value: d._newCount }))
    await writeCellValues(feeSheetId, selectedTab, cells, googleToken)
    setMerged(prev => prev.map(row => {
      const d = drafted.find(d => d._row._rowIndex === row._rowIndex)
      return d ? { ...row, [rcCol]: String(d._newCount) } : row
    }))
  }

  async function logMessage(channel) {
    if (!logSheetId || !googleToken) return
    try {
      const firstEmail = drafted[0]?.email || ''
      const subjectMatch = firstEmail.match(/^Subject: ([^\n]+)/)
      const subject = subjectMatch ? subjectMatch[1].trim() : 'Fee Reminder — The Heritage School'
      const coreBody = drafted[0]?.whatsapp.replace(/^Dear [^,]+,\n\n/, '') || ''
      await appendLogRow(logSheetId, [
        new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' }),
        senderLabel,
        isTransport ? `Transport Reminder (Term ${transportTerm})` : 'Fee Reminder',
        batchFilter,
        subject,
        coreBody,
        drafted.length,
        channel,
      ], googleToken)
    } catch (e) { console.error('[MessageLog] logMessage error:', e) }
  }

  async function handleCreateDrafts() {
    if (!googleToken) return setError('Please connect your Google account.')
    setIsDraftingGmail(true)
    setGmailDraftResult(null)
    setError('')
    let created = 0
    let skipped = 0
    let failedStudent = null
    try {
      for (const d of drafted) {
        const to = d._student['Email Address']
        const studentLabel = d._displayName || `${d._student['First Name'] || ''} ${d._student['Last Name'] || ''}`.replace(/\s+/g, ' ').trim() || '(unnamed student)'
        if (!to) { skipped++; continue }
        const emailLines = d.email.split('\n')
        const firstLine = emailLines[0] || ''
        const subjectMatch = firstLine.match(/^Subject: (.+)/)
        const subject = subjectMatch ? subjectMatch[1].trim() : 'Fee Reminder — The Heritage School'
        const bodyStartIdx = emailLines.findIndex((l, i) => i > 0 && l.trim() !== '')
        const body = bodyStartIdx > 0 ? emailLines.slice(bodyStartIdx).join('\n') : emailLines.slice(1).join('\n').trimStart()
        try {
          await createGmailDraft(to, subject, body, googleToken)
          created++
        } catch (perStudentErr) {
          failedStudent = { name: studentLabel, email: to, error: perStudentErr }
          throw perStudentErr
        }
      }
      await writeReminderCounts()
      await logMessage('Email')
      setGmailDraftResult({ created, skipped })
    } catch (e) {
      if (isAuthError(e)) onAuthError?.()
      const who = failedStudent ? ` (failed on ${failedStudent.name} <${failedStudent.email}>)` : ''
      setError(`${friendlyGmailError(e)} ${created} draft${created !== 1 ? 's' : ''} were created before this${who}. You can click Create Drafts again — already-drafted emails will be re-drafted.`)
    } finally {
      setIsDraftingGmail(false)
    }
  }

  async function handleWhatsAppAll(e) {
    e?.stopPropagation()
    if (isSendingWA.current) return
    isSendingWA.current = true
    setShowConfirm(false)
    let opened = 0, skipped = 0
    try {
      for (const d of drafted) {
        const phone = (d._student['Contact No'] || '').replace(/\D/g, '')
        if (!phone) { skipped++; continue }
        const waPhone = phone.length === 10 ? `91${phone}` : phone
        window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(d.whatsapp)}`, '_blank')
        opened++
        await new Promise(r => setTimeout(r, 2000))
      }
      try { await writeReminderCounts() } catch (err) { if (isAuthError(err)) onAuthError?.() }
      await logMessage('WhatsApp')
      if (skipped > 0) {
        setError(`Opened ${opened} WhatsApp chat${opened !== 1 ? 's' : ''}. Skipped ${skipped} — missing phone number.`)
      }
    } finally {
      isSendingWA.current = false
    }
  }

  if (!feeSheetId) {
    return <p className="text-navy-400 text-sm text-center py-12">Enter the FeeTracker Sheet ID above and load data to begin.</p>
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Tab selector + Load button */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-navy-400 mb-1">Fee Sheet Tab</label>
          <select
            value={selectedTab}
            onChange={e => handleTabChange(e.target.value)}
            className="bg-navy-800 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500"
          >
            <option value="Fees">Fees</option>
            <option value="Transport">Transport</option>
          </select>
        </div>
        {isTransport && loaded && (
          <div>
            <label className="block text-xs text-navy-400 mb-1">Term</label>
            <select
              value={transportTerm}
              onChange={e => handleTermChange(e.target.value)}
              className="bg-navy-800 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500"
            >
              <option value="I">Term I</option>
              <option value="II">Term II</option>
              <option value="III">Term III</option>
            </select>
          </div>
        )}
        <button
          onClick={() => loadFeeData(selectedTab)}
          disabled={isLoading}
          className="px-5 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors flex items-center gap-2"
        >
          {isLoading
            ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Loading…</>
            : `Load ${selectedTab} Tab`}
        </button>
      </div>

      {isLoading ? null : !loaded ? (
        <p className="text-navy-500 text-sm text-center py-12">Select a tab and click Load to view records.</p>
      ) : merged.length === 0 ? (
        <p className="text-navy-400 text-sm text-center py-12">No matching records found in the {selectedTab} tab.</p>
      ) : (
        <>
          {/* Batch filter + counter row */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div>
                <label className="block text-xs text-navy-400 mb-1">Filter by Batch</label>
                <select
                  value={batchFilter}
                  onChange={e => { setBatchFilter(e.target.value); setDrafted([]) }}
                  className="bg-navy-800 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500"
                >
                  <option>All Batches</option>
                  {batches.map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div className="flex gap-4 text-sm pt-4">
                <span className="text-red-400 font-semibold">{visibleUnpaid.length} unpaid</span>
                <span className="text-green-400 font-semibold">{visiblePaid} paid</span>
                <span className="text-navy-400">of {visibleRows.length}{batchFilter !== 'All Batches' ? ` in ${batchFilter}` : ''}</span>
              </div>
            </div>
            <button onClick={() => loadFeeData(selectedTab)} className="text-xs text-navy-400 hover:text-gold-400 transition-colors">↺ Refresh</button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-lg border border-navy-700">
            <table className="w-full text-sm">
              <thead className="bg-navy-800">
                <tr>
                  <th className="px-3 py-2 text-left">
                    <input
                      ref={masterCheckboxRef}
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      className="accent-gold-400 w-4 h-4"
                      title={allChecked ? 'Uncheck all' : 'Check all'}
                    />
                  </th>
                  {(isTransport
                    ? ['Student Name', 'Email', 'Contact', 'Class', "Father's Name", `Term ${transportTerm} Amount`, 'Reminders']
                    : ['Student Name', 'Email', 'Contact', 'Batch', 'Fee Type', 'Amount', 'Due Date', 'Term', 'Reminders']
                  ).map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs text-gold-400 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(row => {
                  const s = row._student
                  const name = rowDisplayName(row)
                  const isPaid = paidMap[row._rowIndex]
                  const missingEmail = !isPaid && !s['Email Address']
                  return (
                    <tr key={row._rowIndex} className={`border-t border-navy-700 ${isPaid ? 'opacity-50' : ''} ${missingEmail ? 'bg-red-950/40' : ''} hover:bg-navy-800/50 transition-colors`}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={!!isPaid}
                          onChange={() => togglePaid(row._rowIndex)}
                          className="accent-gold-400 w-4 h-4"
                        />
                      </td>
                      <td className="px-3 py-2 text-white whitespace-nowrap">{name}</td>
                      <td className="px-3 py-2 text-xs">
                        {s['Email Address']
                          ? <span className="text-navy-300">{s['Email Address']}</span>
                          : <span className="text-red-400 font-medium">No email — update StudentList</span>}
                      </td>
                      <td className="px-3 py-2 text-navy-300 text-xs whitespace-nowrap">{s['Contact No']}</td>
                      <td className="px-3 py-2 text-navy-300 text-xs whitespace-nowrap">{rowBatch(row) || '—'}</td>
                      {isTransport ? (
                        <>
                          <td className="px-3 py-2 text-navy-200 text-xs whitespace-nowrap">{row['Fathers Name'] || '—'}</td>
                          <td className="px-3 py-2 text-gold-400 text-xs font-medium">₹{rowAmount(row)}</td>
                          <td className="px-3 py-2 text-navy-300 text-xs text-center">{rowReminderCount(row)}</td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-navy-200 text-xs">{row['Fee Type']}</td>
                          <td className="px-3 py-2 text-gold-400 text-xs font-medium">₹{rowAmount(row)}</td>
                          <td className="px-3 py-2 text-navy-300 text-xs">{row['Due Date']}</td>
                          <td className="px-3 py-2 text-navy-300 text-xs">{row['Term'] || '—'}</td>
                          <td className="px-3 py-2 text-navy-300 text-xs text-center">{rowReminderCount(row)}</td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 items-end">
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
            <button
              onClick={handleDraft}
              disabled={!visibleUnpaid.length}
              className="px-5 py-2 min-h-[44px] bg-gold-500 hover:bg-gold-400 active:bg-gold-600 disabled:opacity-50 disabled:cursor-not-allowed text-navy-900 font-semibold rounded-lg text-sm transition-colors"
            >
              {draftSuccess ? '✓ Drafted' : `Draft Reminders (${visibleUnpaid.length})`}
            </button>

            <button
              onClick={handleWriteStatus}
              disabled={isWriting}
              className="px-5 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
            >
              {isWriting ? <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />Writing…</> : writeSuccess ? '✓ Saved' : 'Write Status to Sheet'}
            </button>

            {visibleUnpaid.length > 0 && (
              <button onClick={handleCopyAllEmails} className="px-5 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 text-white font-medium rounded-lg text-sm transition-colors">
                {copyEmailsSuccess ? '✓ Copied' : 'Copy All Emails'}
              </button>
            )}

            {drafted.length > 0 && (
              <>
                <button
                  onClick={handleCreateDrafts}
                  disabled={isDraftingGmail}
                  className="px-5 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg text-sm transition-colors flex items-center gap-2"
                >
                  {isDraftingGmail
                    ? <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Creating Drafts…</>
                    : '✉ Create Drafts'}
                </button>
                <button
                  onClick={() => window.open('https://mail.google.com/mail/u/0/#drafts', '_blank')}
                  className="px-5 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 text-white font-medium rounded-lg text-sm transition-colors"
                >
                  Open Gmail Drafts
                </button>
                <button type="button" onClick={e => { e.stopPropagation(); setShowConfirm(true) }} className="px-5 py-2 min-h-[44px] bg-green-800 hover:bg-green-700 active:bg-green-900 text-white font-medium rounded-lg text-sm transition-colors">
                  WhatsApp All ({drafted.length})
                </button>
                <button onClick={handleCopyBroadcast} className="px-5 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 text-white font-medium rounded-lg text-sm transition-colors">
                  {broadcastCopySuccess ? '✓ Copied!' : 'Copy for Broadcast'}
                </button>
              </>
            )}
          </div>

          {/* Gmail draft success banner */}
          {gmailDraftResult !== null && (
            <div className={`border rounded-lg px-4 py-3 text-sm flex items-start justify-between gap-4 ${gmailDraftResult.skipped > 0 ? 'bg-amber-900/40 border-amber-700 text-amber-300' : 'bg-green-900/40 border-green-700 text-green-300'}`}>
              <span>
                <span className="font-semibold">
                  {gmailDraftResult.created} draft{gmailDraftResult.created !== 1 ? 's' : ''} created in your Gmail
                  {gmailDraftResult.skipped > 0 && `, ${gmailDraftResult.skipped} skipped — missing email address`}.
                </span>{' '}
                {gmailDraftResult.created > 0 && 'Go to your Drafts folder to review and send.'}
                {gmailDraftResult.skipped > 0 && ' Please add the missing email addresses in the StudentList sheet.'}
              </span>
              <button onClick={() => setGmailDraftResult(null)} className="hover:opacity-70 leading-none flex-shrink-0">×</button>
            </div>
          )}

          {/* Confirm Dialog */}
          {showConfirm && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowConfirm(false)}>
              <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 max-w-sm mx-4" onClick={e => e.stopPropagation()}>
                <h3 className="text-white font-semibold mb-2">Send WhatsApp to {drafted.length} parents?</h3>
                <p className="text-navy-300 text-sm mb-5">This will open {drafted.length} WhatsApp windows with a 2-second delay between each.</p>
                <div className="flex gap-3">
                  <button type="button" onClick={handleWhatsAppAll} className="flex-1 min-h-[44px] py-2 bg-green-700 hover:bg-green-600 text-white rounded-lg text-sm font-medium">Yes, Send All</button>
                  <button type="button" onClick={e => { e.stopPropagation(); setShowConfirm(false) }} className="flex-1 min-h-[44px] py-2 bg-navy-700 hover:bg-navy-600 text-white rounded-lg text-sm">Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* Voice Message */}
          {drafted.length > 0 && (
            <VoicePlayer
              text={drafted[0]?.whatsapp || ''}
              language="English"
              googleToken={googleToken}
              label="Fee Reminder Voice Message"
              onAuthError={onAuthError}
            />
          )}

          {/* Drafted Messages */}
          {drafted.length > 0 && (
            <div>
              <h3 className="text-gold-400 font-semibold mb-3 text-sm">{drafted.length} drafts ready</h3>
              <div className="space-y-2">
                {drafted.map((d, i) => (
                  <MessageCard
                    key={i}
                    student={{ ...d._student, 'Student Name': d._displayName || `${d._student['First Name']} ${d._student['Last Name']}`.replace(/\s+/g, ' ').trim() }}
                    emailDraft={d.email}
                    whatsappDraft={d.whatsapp}
                    onEmailChange={text => setDrafted(prev => prev.map((item, idx) => idx === i ? { ...item, email: text } : item))}
                    onWhatsAppChange={text => setDrafted(prev => prev.map((item, idx) => idx === i ? { ...item, whatsapp: text } : item))}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Bottom padding so content isn't hidden behind sticky footer */}
      {loaded && <div className="h-20" />}

      {/* Sticky Footer */}
      {loaded && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-navy-900 border-t border-navy-700 px-6 py-3">
          <div className="max-w-6xl mx-auto flex flex-wrap gap-3 items-center">
            <select
              value={senderLabel}
              onChange={e => { setSenderLabel(e.target.value); setDrafted([]) }}
              className="bg-navy-800 border border-navy-600 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-gold-500"
            >
              {SENDERS.map(s => <option key={s.label} value={s.label}>{s.label}</option>)}
            </select>

            <button
              onClick={handleDraft}
              disabled={!visibleUnpaid.length}
              className="px-4 py-2 min-h-[44px] bg-gold-500 hover:bg-gold-400 active:bg-gold-600 disabled:opacity-50 disabled:cursor-not-allowed text-navy-900 font-semibold rounded-lg text-sm transition-colors"
            >
              {draftSuccess ? '✓ Drafted' : `Draft Reminders (${visibleUnpaid.length})`}
            </button>

            <button
              onClick={handleWriteStatus}
              disabled={isWriting}
              className="px-4 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition-colors"
            >
              {isWriting ? <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />Writing…</> : writeSuccess ? '✓ Saved' : 'Write Status to Sheet'}
            </button>

            {visibleUnpaid.length > 0 && (
              <button onClick={handleCopyAllEmails} className="px-4 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 text-white font-medium rounded-lg text-sm transition-colors">
                {copyEmailsSuccess ? '✓ Copied' : 'Copy All Emails'}
              </button>
            )}

            {drafted.length > 0 && (
              <>
                <button
                  onClick={handleCreateDrafts}
                  disabled={isDraftingGmail}
                  className="px-4 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg text-sm transition-colors flex items-center gap-2"
                >
                  {isDraftingGmail
                    ? <><span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Creating Drafts…</>
                    : '✉ Create Drafts'}
                </button>
                <button
                  onClick={() => window.open('https://mail.google.com/mail/u/0/#drafts', '_blank')}
                  className="px-4 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 text-white font-medium rounded-lg text-sm transition-colors"
                >
                  Open Gmail Drafts
                </button>
                <button onClick={() => setShowConfirm(true)} className="px-4 py-2 min-h-[44px] bg-green-800 hover:bg-green-700 active:bg-green-900 text-white font-medium rounded-lg text-sm transition-colors">
                  WhatsApp All ({drafted.length})
                </button>
                <button onClick={handleCopyBroadcast} className="px-4 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 text-white font-medium rounded-lg text-sm transition-colors">
                  {broadcastCopySuccess ? '✓ Copied!' : 'Copy for Broadcast'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
