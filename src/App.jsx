import { useState, useRef, useEffect } from 'react'
import { readSheet, parseSheetData, getSheetTabIds, batchUpdateValues, highlightRows, deleteRows } from './utils/sheets'
import { isAuthError, friendlySheetsError } from './utils/errors'
import FeeReminders from './components/FeeReminders'
import GeneralBroadcast from './components/GeneralBroadcast'
import Attendance from './components/Attendance'
import ExportModal from './components/ExportModal'

function load(key, fallback = '') { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
function save(key, val) { try { localStorage.setItem(key, val) } catch {} }

function studentAdmissionNo(row) {
  return (row['Admission No.'] || '').trim()
}

function studentFullName(row) {
  return `${row['First Name'] || ''} ${row['Last Name'] || ''}`.trim()
}

function feeTrackerRowFromStudent(row) {
  return [
    studentAdmissionNo(row),
    studentFullName(row),
    row['Batch Name'] || '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    0,
    0,
    0,
  ]
}

function countFilledCells(row, headers) {
  return headers.reduce((count, header) => count + ((row[header] || '').trim() ? 1 : 0), 0)
}

function isDuplicateHeaderRow(row, headers) {
  return headers.every(header => (row[header] || '').trim() === header)
}

export default function App() {
  const [activeTab, setActiveTab] = useState('fee')
  const [showSettings, setShowSettings] = useState(false)

  const [anthropicKey, setAnthropicKey] = useState(load('hs_anthropic_key'))
  const [googleClientId, setGoogleClientId] = useState(load('hs_google_client_id'))
  const [studentSheetId, setStudentSheetId] = useState(load('hs_student_sheet'))
  const [feeSheetId, setFeeSheetId] = useState(load('hs_fee_sheet'))
  const [logSheetId, setLogSheetId] = useState(load('hs_log_sheet'))

  const [googleToken, setGoogleToken] = useState(null)
  const [isGoogleAuthed, setIsGoogleAuthed] = useState(false)
  const [studentData, setStudentData] = useState([])
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [dataError, setDataError] = useState('')
  const [dataLoaded, setDataLoaded] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [showExport, setShowExport] = useState(false)
  const [isCleaning, setIsCleaning] = useState(false)
  const [cleanResult, setCleanResult] = useState(null)
  const [stubScan, setStubScan] = useState(null)
  const [settingsError, setSettingsError] = useState('')
  const [toastMessage, setToastMessage] = useState('')

  const tokenClientRef = useRef(null)
  const refreshTimerRef = useRef(null)
  const toastTimerRef = useRef(null)

  function showToast(message) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastMessage(message)
    toastTimerRef.current = setTimeout(() => setToastMessage(''), 5000)
  }

  function scheduleRefresh(expiresIn) {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    // Refresh 5 minutes before expiry; tokens are typically 3600s
    const delay = Math.max((expiresIn - 300) * 1000, 0)
    refreshTimerRef.current = setTimeout(() => {
      // prompt: '' = silent refresh, no popup if permission already granted
      tokenClientRef.current?.requestAccessToken({ prompt: '' })
    }, delay)
  }

  useEffect(() => () => {
    clearTimeout(refreshTimerRef.current)
    clearTimeout(toastTimerRef.current)
  }, [])

  useEffect(() => {
    if (!googleClientId) return
    const init = () => {
      if (!window.google?.accounts?.oauth2) return
      tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/gmail.compose',
        callback: (resp) => {
          if (resp.error) return
          setGoogleToken(resp.access_token)
          setIsGoogleAuthed(true)
          scheduleRefresh(resp.expires_in ?? 3600)
        },
      })
    }
    if (window.google) init()
    else window.addEventListener('load', init)
    return () => window.removeEventListener('load', init)
  }, [googleClientId])

  // Auto-fire Load Data once Google is connected and both Sheet IDs are
  // configured. Guards prevent a retry loop after a manual error.
  useEffect(() => {
    if (
      googleToken &&
      studentSheetId &&
      feeSheetId &&
      !dataLoaded &&
      !isLoadingData &&
      !dataError
    ) {
      loadData()
    }
  }, [googleToken, studentSheetId, feeSheetId, dataLoaded, isLoadingData, dataError])

  function handleGoogleAuth() {
    if (!googleClientId) {
      setShowSettings(true)
      return
    }
    // Treat a manual Connect as the start of a fresh session — reset the
    // load guards so the auto-load effect fires once the token arrives.
    setDataLoaded(false)
    setDataError('')
    tokenClientRef.current?.requestAccessToken()
  }

  // Google Sheet IDs are typically 40+ chars of alphanumeric/-/_.
  // Empty is allowed (the user may want to clear an unused slot).
  function isValidSheetId(id) {
    if (!id) return true
    return /^[a-zA-Z0-9_-]{20,}$/.test(id.trim())
  }

  function saveSettings() {
    const bad = [
      ['StudentList', studentSheetId],
      ['FeeTracker', feeSheetId],
      ['MessageLog', logSheetId],
    ].filter(([, id]) => id && !isValidSheetId(id)).map(([n]) => n)
    if (bad.length) {
      setSettingsError(`Invalid Sheet ID format for: ${bad.join(', ')}. IDs are the long string between /d/ and /edit in the sheet URL.`)
      return
    }
    setSettingsError('')
    save('hs_anthropic_key', anthropicKey)
    save('hs_google_client_id', googleClientId)
    save('hs_student_sheet', studentSheetId)
    save('hs_fee_sheet', feeSheetId)
    save('hs_log_sheet', logSheetId)
    setShowSettings(false)
    setIsGoogleAuthed(false)
    setGoogleToken(null)
  }

  // Called by any component whose API call returns 401/403. Clears the
  // session but preserves loaded student data so staff don't lose work.
  function handleAuthError() {
    setIsGoogleAuthed(false)
    setGoogleToken(null)
    setDataError('Session expired. Please click Connect Google Account to continue — your loaded data is preserved.')
  }

  async function loadData() {
    if (!studentSheetId) {
      setShowSettings(true)
      return
    }
    if (!feeSheetId) {
      setShowSettings(true)
      return
    }
    if (!googleToken) return setDataError('Connect your Google Account first.')
    setIsLoadingData(true)
    setDataError('')
    try {
      const values = await readSheet(studentSheetId, 'Students!A:Z', googleToken)
      const { rows } = parseSheetData(values)
      const processed = rows.map(s => ({
        ...s,
        'Student Name': studentFullName(s),
      }))
      await cleanupFeesTab()
      const addedCount = await addMissingStudentsToFees(processed)
      const feesCount = await countFeesDataRows()
      setStudentData(processed)
      setDataLoaded(true)
      showToast(`${addedCount} new students added to FeeTracker. Staff needs to fill in fee amounts per batch.`)
      if (processed.length === 0) {
        setDataError('StudentList loaded successfully but contains 0 students. Check the StudentList sheet has rows beyond the header.')
      } else if (feesCount !== processed.length) {
        setDataError(`FeeTracker Fees tab has ${feesCount} data rows after cleanup; expected ${processed.length} from StudentList.`)
      }
    } catch (e) {
      if (isAuthError(e)) handleAuthError()
      else setDataError(friendlySheetsError(e))
    } finally {
      setIsLoadingData(false)
    }
  }

  async function cleanupFeesTab() {
    const tabIds = await getSheetTabIds(feeSheetId, googleToken)
    const feesTabId = tabIds['Fees']
    if (feesTabId === undefined) throw new Error('Fees tab not found in FeeTracker.')

    const feeValues = await readSheet(feeSheetId, 'Fees!A:N', googleToken)
    const { headers, rows } = parseSheetData(feeValues)
    const rowsToDelete = new Set()

    rows.forEach(row => {
      const isBlank = headers.every(header => !(row[header] || '').trim())
      if (isBlank || isDuplicateHeaderRow(row, headers)) rowsToDelete.add(row._rowIndex)
    })

    const rowsByAdmissionNo = new Map()
    rows.forEach(row => {
      if (rowsToDelete.has(row._rowIndex)) return
      const adm = studentAdmissionNo(row)
      if (!adm || adm === 'Admission No.') return
      const current = rowsByAdmissionNo.get(adm)
      if (!current) {
        rowsByAdmissionNo.set(adm, row)
        return
      }

      const currentScore = countFilledCells(current, headers)
      const rowScore = countFilledCells(row, headers)
      if (rowScore > currentScore) {
        rowsToDelete.add(current._rowIndex)
        rowsByAdmissionNo.set(adm, row)
      } else {
        rowsToDelete.add(row._rowIndex)
      }
    })

    if (rowsToDelete.size) {
      await deleteRows(feeSheetId, feesTabId, [...rowsToDelete], googleToken)
    }
  }

  async function countFeesDataRows() {
    const feeValues = await readSheet(feeSheetId, 'Fees!A:N', googleToken)
    const { rows } = parseSheetData(feeValues)
    return rows.filter(row => {
      const adm = studentAdmissionNo(row)
      return adm && adm !== 'Admission No.'
    }).length
  }

  async function addMissingStudentsToFees(studentRows) {
    const feeValues = await readSheet(feeSheetId, 'Fees!A:N', googleToken)
    const { rows: feeRows } = parseSheetData(feeValues)
    const feeAdmNos = new Set(feeRows.map(studentAdmissionNo).filter(Boolean))
    const seenNewAdmNos = new Set()
    const toAdd = studentRows.filter(row => {
      const adm = studentAdmissionNo(row)
      if (!adm || feeAdmNos.has(adm) || seenNewAdmNos.has(adm)) return false
      seenNewAdmNos.add(adm)
      return true
    })

    if (!toAdd.length) return 0

    const startRow = feeValues.length + 1
    await batchUpdateValues(feeSheetId, [{
      range: `Fees!A${startRow}:N${startRow + toAdd.length - 1}`,
      values: toAdd.map(feeTrackerRowFromStudent),
    }], googleToken)

    return toAdd.length
  }

  async function syncStudents() {
    if (!googleToken || !studentSheetId || !feeSheetId) return
    setIsSyncing(true)
    setSyncResult(null)
    try {
      const studentValues = await readSheet(studentSheetId, 'Students!A:Z', googleToken)
      const { rows: studentRows } = parseSheetData(studentValues)
      const studentAdmNos = new Set(studentRows.map(studentAdmissionNo).filter(Boolean))

      const tabIds = await getSheetTabIds(feeSheetId, googleToken)

      let totalAdded = 0
      let totalFlagged = 0

      for (const tab of ['Fees', 'Transport']) {
        const feeValues = await readSheet(feeSheetId, `${tab}!A:G`, googleToken)
        const { rows: feeRows } = parseSheetData(feeValues)
        if (tab === 'Fees') {
          totalAdded += await addMissingStudentsToFees(studentRows)
        }

        const toFlag = feeRows.filter(r => {
          const adm = (r['Admission No.'] || '').trim()
          return adm && !studentAdmNos.has(adm)
        })
        if (toFlag.length && tabIds[tab] !== undefined) {
          await highlightRows(feeSheetId, tabIds[tab], toFlag.map(r => r._rowIndex), googleToken)
          totalFlagged += toFlag.length
        }
      }

      const s = n => n !== 1 ? 's' : ''
      setSyncResult(`${totalAdded} new student${s(totalAdded)} added, ${totalFlagged} student${s(totalFlagged)} flagged as no longer in StudentList.`)
      showToast(`${totalAdded} new students added to FeeTracker. Staff needs to fill in fee amounts per batch.`)
    } catch (e) {
      if (isAuthError(e)) handleAuthError()
      setSyncResult(`Error: ${friendlySheetsError(e)}`)
    } finally {
      setIsSyncing(false)
    }
  }

  async function scanTransportStubs() {
    if (!googleToken || !feeSheetId) return
    if (!dataLoaded) {
      setCleanResult('Load student data first — needed to tell stubs from rows for removed students.')
      return
    }
    setIsCleaning(true)
    setCleanResult(null)
    try {
      const values = await readSheet(feeSheetId, 'Transport!A:G', googleToken)
      const { headers, rows } = parseSheetData(values)
      const studentAdmNos = new Set(
        studentData.map(s => (s['Admission No.'] || '').trim()).filter(Boolean)
      )
      // A stub is a row whose ONLY filled column is Admission No., and whose
      // student still exists in StudentList. Column-name-agnostic so the rule
      // works whatever the Transport tab's other column names are.
      const stubs = rows.filter(r => {
        const adm = (r['Admission No.'] || '').trim()
        if (!adm || !studentAdmNos.has(adm)) return false
        const hasOtherData = headers.some(h => h !== 'Admission No.' && (r[h] || '').trim())
        return !hasOtherData
      })
      if (!stubs.length) {
        setCleanResult('No stub rows found in Transport.')
        return
      }
      setStubScan({
        count: stubs.length,
        rowIndices: stubs.map(r => r._rowIndex),
        sample: stubs.slice(0, 5).map(r => r['Admission No.']),
      })
    } catch (e) {
      if (isAuthError(e)) handleAuthError()
      setCleanResult(`Error: ${friendlySheetsError(e)}`)
    } finally {
      setIsCleaning(false)
    }
  }

  async function confirmCleanTransport() {
    if (!stubScan) return
    setIsCleaning(true)
    try {
      const tabIds = await getSheetTabIds(feeSheetId, googleToken)
      const transportId = tabIds['Transport']
      if (transportId === undefined) throw new Error('Transport tab not found in FeeTracker.')
      await deleteRows(feeSheetId, transportId, stubScan.rowIndices, googleToken)
      setCleanResult(`Deleted ${stubScan.count} stub row${stubScan.count !== 1 ? 's' : ''} from Transport.`)
      setStubScan(null)
    } catch (e) {
      if (isAuthError(e)) handleAuthError()
      setCleanResult(`Error: ${friendlySheetsError(e)}`)
    } finally {
      setIsCleaning(false)
    }
  }

  return (
    <div className="min-h-screen bg-navy-900 text-white">
      {toastMessage && (
        <div className="fixed top-4 right-4 z-[70] max-w-sm rounded-lg border border-green-700 bg-green-900/95 px-4 py-3 text-sm text-green-100 shadow-lg">
          {toastMessage}
        </div>
      )}

      {/* Header */}
      <header className="bg-navy-800 border-b border-navy-700 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gold-500 flex items-center justify-center">
              <span className="text-navy-900 font-bold text-lg">H</span>
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-none">The Heritage School</h1>
              <p className="text-gold-400 text-xs mt-0.5">Communication App</p>
            </div>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-navy-700 text-navy-400 hover:text-white transition-colors text-xl"
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* Connection bar */}
        <div className="bg-navy-800 rounded-xl border border-navy-700 px-5 py-4 flex flex-wrap items-center gap-4">
          {!isGoogleAuthed ? (
            <button
              onClick={handleGoogleAuth}
              className="px-4 py-2 min-h-[44px] bg-white hover:bg-gray-100 text-navy-900 font-medium rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Connect Google Account
            </button>
          ) : (
            <span className="text-green-400 text-sm font-medium">✓ Google Connected</span>
          )}

          <button
            onClick={loadData}
            disabled={isLoadingData || !isGoogleAuthed}
            className="px-5 py-2 min-h-[44px] bg-gold-500 hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-navy-900 font-semibold rounded-lg text-sm transition-colors flex items-center gap-2"
          >
            {isLoadingData
              ? <><span className="w-4 h-4 border-2 border-navy-900 border-t-transparent rounded-full animate-spin" />Loading…</>
              : 'Load Data'}
          </button>

          {dataLoaded && (
            <span className="text-green-400 text-sm">{studentData.length} students loaded</span>
          )}

          {dataError && (
            <span className="text-red-400 text-sm">{dataError}</span>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-navy-700">
          {[
            { id: 'fee', label: 'Fee Reminders' },
            { id: 'broadcast', label: 'General Broadcast' },
            { id: 'attendance', label: 'Attendance' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-6 py-3 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === t.id
                  ? 'border-gold-500 text-gold-400'
                  : 'border-transparent text-navy-400 hover:text-navy-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div>
          {activeTab === 'fee' ? (
            <FeeReminders
              studentData={studentData}
              dataLoaded={dataLoaded}
              feeSheetId={feeSheetId}
              googleToken={googleToken}
              logSheetId={logSheetId}
              onAuthError={handleAuthError}
            />
          ) : activeTab === 'broadcast' ? (
            <GeneralBroadcast
              studentData={studentData}
              dataLoaded={dataLoaded}
              anthropicKey={anthropicKey}
              googleToken={googleToken}
              logSheetId={logSheetId}
              onAuthError={handleAuthError}
            />
          ) : (
            <Attendance
              studentData={studentData}
              dataLoaded={dataLoaded}
              googleToken={googleToken}
              logSheetId={logSheetId}
              onAuthError={handleAuthError}
            />
          )}
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
          <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 w-full max-w-md space-y-5">
            <h2 className="text-white font-bold text-lg">Settings</h2>

            <div className="space-y-1">
              <p className="text-xs text-gold-400 font-semibold uppercase tracking-wide">API Keys</p>
              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-xs text-navy-400 mb-1">Anthropic API Key</label>
                  <input
                    type="password"
                    value={anthropicKey}
                    onChange={e => setAnthropicKey(e.target.value)}
                    placeholder="sk-ant-…"
                    className="w-full bg-navy-900 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 placeholder-navy-600"
                  />
                  <p className="text-navy-500 text-xs mt-1">console.anthropic.com</p>
                </div>
                <div>
                  <label className="block text-xs text-navy-400 mb-1">Google OAuth Client ID</label>
                  <input
                    value={googleClientId}
                    onChange={e => setGoogleClientId(e.target.value)}
                    placeholder="xxxxxxxx.apps.googleusercontent.com"
                    className="w-full bg-navy-900 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 placeholder-navy-600"
                  />
                  <p className="text-navy-500 text-xs mt-1">console.cloud.google.com → APIs → Credentials</p>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-gold-400 font-semibold uppercase tracking-wide">Google Sheets</p>
              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-xs text-navy-400 mb-1">StudentList Sheet ID</label>
                  <input
                    value={studentSheetId}
                    onChange={e => setStudentSheetId(e.target.value)}
                    placeholder="Paste the Google Sheet ID here"
                    className="w-full bg-navy-900 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 placeholder-navy-600"
                  />
                </div>
                <div>
                  <label className="block text-xs text-navy-400 mb-1">FeeTracker Sheet ID</label>
                  <input
                    value={feeSheetId}
                    onChange={e => setFeeSheetId(e.target.value)}
                    placeholder="Paste the Google Sheet ID here"
                    className="w-full bg-navy-900 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 placeholder-navy-600"
                  />
                </div>
                <div>
                  <label className="block text-xs text-navy-400 mb-1">MessageLog Sheet ID</label>
                  <input
                    value={logSheetId}
                    onChange={e => setLogSheetId(e.target.value)}
                    placeholder="Paste the Google Sheet ID here"
                    className="w-full bg-navy-900 border border-navy-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gold-500 placeholder-navy-600"
                  />
                  <p className="text-navy-500 text-xs mt-1">Create a blank Google Sheet named "MessageLog" — the app writes headers automatically on first use.</p>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-gold-400 font-semibold uppercase tracking-wide">Data Tools</p>
              <div className="pt-1 space-y-2">
                <p className="text-xs text-navy-400">Adds new students from StudentList to the Fees tab (Transport stays opt-in — add manually for transport users), and highlights in red any rows in either tab for students no longer in StudentList. Never deletes — staff reviews flagged rows manually.</p>
                <button
                  onClick={syncStudents}
                  disabled={isSyncing || !isGoogleAuthed || !studentSheetId || !feeSheetId}
                  className="px-4 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg text-sm transition-colors flex items-center gap-2"
                >
                  {isSyncing
                    ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Syncing…</>
                    : 'Sync Students'}
                </button>
                {syncResult && (
                  <p className={`text-xs ${syncResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{syncResult}</p>
                )}

                <div className="pt-3 border-t border-navy-700 space-y-2">
                  <p className="text-xs text-navy-400">Deletes stub rows from the Transport tab — rows where Fee Type and Amount Due are both empty AND the Admission No. still exists in StudentList. Flagged rows (students no longer in StudentList) are left alone for manual review.</p>
                  <button
                    onClick={scanTransportStubs}
                    disabled={isCleaning || !isGoogleAuthed || !feeSheetId || !dataLoaded}
                    title={!dataLoaded ? 'Load student data first' : undefined}
                    className="px-4 py-2 min-h-[44px] bg-navy-700 hover:bg-navy-600 active:bg-navy-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg text-sm transition-colors flex items-center gap-2"
                  >
                    {isCleaning
                      ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Working…</>
                      : 'Clean Transport Stubs'}
                  </button>
                  {cleanResult && (
                    <p className={`text-xs ${cleanResult.startsWith('Error') ? 'text-red-400' : 'text-green-400'}`}>{cleanResult}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-1">
              <button
                onClick={() => { setShowSettings(false); setShowExport(true) }}
                className="w-full min-h-[44px] py-2 bg-navy-700 hover:bg-navy-600 active:bg-navy-500 text-white font-medium rounded-lg text-sm transition-colors"
              >
                Export Data →
              </button>
            </div>

            {settingsError && (
              <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-xs">{settingsError}</div>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={saveSettings} className="flex-1 min-h-[44px] py-2 bg-gold-500 hover:bg-gold-400 text-navy-900 font-semibold rounded-lg text-sm">Save</button>
              <button onClick={() => { setSettingsError(''); setShowSettings(false) }} className="flex-1 min-h-[44px] py-2 bg-navy-700 hover:bg-navy-600 text-white rounded-lg text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {stubScan && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] px-4" onClick={() => !isCleaning && setStubScan(null)}>
          <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-bold text-lg">Delete {stubScan.count} stub row{stubScan.count !== 1 ? 's' : ''}?</h3>
            <p className="text-navy-300 text-sm">
              These rows in the Transport tab have only an Admission No. — no Fee Type or Amount Due. Deletion cannot be undone from this app (use the sheet's version history if needed).
            </p>
            <div className="bg-navy-900 border border-navy-700 rounded-lg px-3 py-2">
              <p className="text-xs text-navy-400 mb-1">Sample admission numbers:</p>
              <p className="text-xs text-navy-200 font-mono break-all">
                {stubScan.sample.join(', ')}{stubScan.count > stubScan.sample.length ? ` … (+${stubScan.count - stubScan.sample.length} more)` : ''}
              </p>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={confirmCleanTransport}
                disabled={isCleaning}
                className="flex-1 min-h-[44px] py-2 bg-red-700 hover:bg-red-600 active:bg-red-800 disabled:opacity-50 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              >
                {isCleaning
                  ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />Deleting…</>
                  : `Delete ${stubScan.count}`}
              </button>
              <button
                onClick={() => setStubScan(null)}
                disabled={isCleaning}
                className="flex-1 min-h-[44px] py-2 bg-navy-700 hover:bg-navy-600 disabled:opacity-50 text-white rounded-lg text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showExport && (
        <ExportModal
          googleToken={googleToken}
          studentSheetId={studentSheetId}
          feeSheetId={feeSheetId}
          logSheetId={logSheetId}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  )
}
