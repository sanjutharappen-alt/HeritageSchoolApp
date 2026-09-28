import { useState, useMemo } from 'react'
import { appendLogRow } from '../utils/sheets'
import { sortBatches } from '../utils/batches'
import { isAuthError } from '../utils/errors'

function todayIsoDate() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatDateLong(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function whatsappMessage(studentName, batch, isoDate) {
  return `Dear Parent,\n\nWe wish to inform you that your child ${studentName}, Class ${batch} was absent from school today, ${formatDateLong(isoDate)}. Please ensure regular attendance. If your child is unwell, kindly inform the class teacher. Thank you.\n\n- The Heritage School\nAdministration`
}

function emailBody(batch, isoDate) {
  return `Dear Parent,

We wish to inform you that your child was marked absent from school today, ${formatDateLong(isoDate)}, in Class ${batch}.

Please ensure regular attendance going forward. If your child is unwell, kindly inform the class teacher at the earliest.

Thank you for your continued support and cooperation.

Regards,
The Heritage School | Administration`
}

export default function Attendance({ studentData, dataLoaded: parentDataLoaded, googleToken, logSheetId, onAuthError }) {
  const [batch, setBatch] = useState('')
  const [date, setDate] = useState(todayIsoDate())
  const [presentMap, setPresentMap] = useState({})
  const [error, setError] = useState('')
  const [copyEmailsSuccess, setCopyEmailsSuccess] = useState(false)
  const [copyWaSuccess, setCopyWaSuccess] = useState(false)
  const [gmailSuccess, setGmailSuccess] = useState(false)
  const [waWebOpened, setWaWebOpened] = useState(false)

  const batches = useMemo(() => {
    const unique = [...new Set(studentData.map(s => s['Batch Name']).filter(Boolean))]
    return sortBatches(unique)
  }, [studentData])

  const students = useMemo(() => {
    if (!batch) return []
    return studentData
      .filter(s => s['Batch Name'] === batch)
      .map(s => ({
        ...s,
        'Student Name': `${s['First Name'] || ''} ${s['Last Name'] || ''}`.replace(/\s+/g, ' ').trim(),
      }))
      .sort((a, b) => a['Student Name'].localeCompare(b['Student Name']))
  }, [studentData, batch])

  function studentKey(s) {
    return s['Admission No.'] || `${s['First Name']}_${s['Last Name']}_${s['Contact No']}`
  }

  function isPresent(s) {
    const k = studentKey(s)
    return presentMap[k] !== false
  }

  function togglePresent(s) {
    const k = studentKey(s)
    setPresentMap(prev => ({ ...prev, [k]: !isPresent(s) }))
  }

  function resetForBatch(newBatch) {
    setBatch(newBatch)
    setPresentMap({})
    setError('')
    setWaWebOpened(false)
  }

  function handleDateChange(newDate) {
    setDate(newDate)
    setWaWebOpened(false)
  }

  const absentStudents = students.filter(s => !isPresent(s))
  const presentCount = students.length - absentStudents.length
  const absentCount = absentStudents.length

  async function logAttendance(channel) {
    if (!logSheetId || !googleToken) return
    try {
      await appendLogRow(logSheetId, [
        new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' }),
        'The Heritage School Administration',
        'Attendance Notice',
        batch,
        `Attendance Notice — ${batch} — ${formatDateLong(date)} | The Heritage School`,
        emailBody(batch, date),
        absentCount,
        channel,
      ], googleToken)
    } catch (e) {
      if (isAuthError(e)) onAuthError?.()
      // MessageLog failures must never block the send action — log + move on.
      console.error('[MessageLog] Attendance log error:', e)
    }
  }

  function handleCopyAbsentEmails() {
    const emails = absentStudents
      .map(s => s['Email Address'])
      .filter(Boolean)
      .join(', ')
    if (!emails) {
      setError('No email addresses found for absent students.')
      return
    }
    navigator.clipboard.writeText(emails)
    setError('')
    setCopyEmailsSuccess(true)
    setTimeout(() => setCopyEmailsSuccess(false), 2000)
  }

  function handleCopyWhatsAppMessage() {
    const template = whatsappMessage('[Student Name]', batch, date)
    navigator.clipboard.writeText(template)
    setError('')
    setCopyWaSuccess(true)
    setTimeout(() => setCopyWaSuccess(false), 2000)
  }

  async function handleOpenWhatsAppWeb() {
    window.open('https://web.whatsapp.com', '_blank')
    if (!waWebOpened) {
      await logAttendance('WhatsApp')
      setWaWebOpened(true)
    }
  }

  function handleRowWhatsApp(s) {
    const phone = (s['Contact No'] || '').replace(/\D/g, '')
    if (!phone) {
      setError(`No contact number on file for ${s['Student Name']}.`)
      return
    }
    setError('')
    const waPhone = phone.length === 10 ? `91${phone}` : phone
    const msg = whatsappMessage(s['Student Name'], batch, date)
    window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  async function handleOpenGmailDraft() {
    const bccList = absentStudents
      .map(s => s['Email Address'])
      .filter(Boolean)
      .join(',')
    if (!bccList) {
      setError('No email addresses found for absent students.')
      return
    }
    setError('')
    const subject = `Attendance Notice — ${batch} — ${formatDateLong(date)} | The Heritage School`
    const url = `https://mail.google.com/mail/?view=cm&bcc=${encodeURIComponent(bccList)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody(batch, date))}`
    window.open(url, '_blank')
    await logAttendance('Email')
    setGmailSuccess(true)
    setTimeout(() => setGmailSuccess(false), 2500)
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

      {/* Date + Batch selectors */}
      <div className="flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs text-navy-400 mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={e => handleDateChange(e.target.value)}
            className="bg-navy-800 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500"
          />
        </div>
        <div>
          <label className="block text-xs text-navy-400 mb-1">Batch</label>
          <select
            value={batch}
            onChange={e => resetForBatch(e.target.value)}
            className="bg-navy-800 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500"
          >
            <option value="">Select Batch</option>
            {batches.map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
      </div>

      {!batch ? (
        <p className="text-navy-500 text-sm text-center py-12">Select a batch to mark attendance.</p>
      ) : students.length === 0 ? (
        <p className="text-navy-400 text-sm text-center py-12">No students found in {batch}.</p>
      ) : (
        <>
          {/* Live counter */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex gap-4 text-sm">
              <span className="text-red-400 font-semibold">{absentCount} absent</span>
              <span className="text-green-400 font-semibold">{presentCount} present</span>
              <span className="text-navy-400">of {students.length} in {batch}</span>
            </div>
          </div>

          {/* Student table */}
          <div className="overflow-x-auto rounded-lg border border-navy-700">
            <table className="w-full text-sm">
              <thead className="bg-navy-800">
                <tr>
                  <th className="px-3 py-2 text-left text-xs text-gold-400 font-semibold whitespace-nowrap">Present</th>
                  <th className="px-3 py-2 text-left text-xs text-gold-400 font-semibold whitespace-nowrap">Student Name</th>
                  <th className="px-3 py-2 text-left text-xs text-gold-400 font-semibold whitespace-nowrap">Parent Email</th>
                  <th className="px-3 py-2 text-left text-xs text-gold-400 font-semibold whitespace-nowrap">Contact No</th>
                  <th className="px-3 py-2 text-left text-xs text-gold-400 font-semibold whitespace-nowrap">Send</th>
                </tr>
              </thead>
              <tbody>
                {students.map(s => {
                  const present = isPresent(s)
                  const hasPhone = !!(s['Contact No'] || '').replace(/\D/g, '')
                  return (
                    <tr
                      key={studentKey(s)}
                      className={`border-t border-navy-700 ${present ? '' : 'bg-red-950/30'} hover:bg-navy-800/50 transition-colors`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={present}
                          onChange={() => togglePresent(s)}
                          className="accent-gold-400 w-4 h-4"
                        />
                      </td>
                      <td className="px-3 py-2 text-white whitespace-nowrap">{s['Student Name']}</td>
                      <td className="px-3 py-2 text-xs">
                        {s['Email Address']
                          ? <span className="text-navy-300">{s['Email Address']}</span>
                          : <span className="text-red-400 font-medium">No email — update StudentList</span>}
                      </td>
                      <td className="px-3 py-2 text-navy-300 text-xs whitespace-nowrap">{s['Contact No'] || <span className="text-red-400">—</span>}</td>
                      <td className="px-3 py-2">
                        {!present && hasPhone ? (
                          <button
                            onClick={() => handleRowWhatsApp(s)}
                            className="px-3 py-2 min-h-[44px] bg-green-700 hover:bg-green-600 active:bg-green-800 text-white text-xs font-medium rounded transition-colors whitespace-nowrap"
                            title={`Send WhatsApp to ${s['Student Name']}`}
                          >
                            Send via WhatsApp
                          </button>
                        ) : (
                          <span className="text-navy-600 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Action buttons — only when at least one absent */}
          {absentCount > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleCopyAbsentEmails}
                  className="px-5 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 text-white font-medium rounded-lg text-sm transition-colors"
                >
                  {copyEmailsSuccess ? '✓ Copied' : `Copy Absent Emails (${absentCount})`}
                </button>
                <button
                  onClick={handleOpenGmailDraft}
                  className="px-5 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 text-white font-medium rounded-lg text-sm transition-colors"
                >
                  {gmailSuccess ? '✓ Gmail Draft Opened' : 'Open Gmail Draft'}
                </button>
                <button
                  onClick={handleCopyWhatsAppMessage}
                  className="px-5 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 text-white font-medium rounded-lg text-sm transition-colors"
                  title="Copies the message with [Student Name] as a placeholder — paste into each chat and edit the name."
                >
                  {copyWaSuccess ? '✓ Copied' : 'Copy WhatsApp Message'}
                </button>
                <button
                  onClick={handleOpenWhatsAppWeb}
                  className="px-5 py-2 min-h-[44px] bg-green-800 hover:bg-green-700 active:bg-green-900 text-white font-medium rounded-lg text-sm transition-colors"
                >
                  Open WhatsApp Web
                </button>
              </div>
              <p className="text-xs text-navy-500">
                Tip: Use the per-row <span className="text-green-400 font-medium">Send via WhatsApp</span> button to message each parent individually with the name pre-filled — or copy the template above and paste into WhatsApp Web.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
