export async function readSheet(sheetId, range, accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Failed to read sheet');
  }
  const data = await res.json();
  return data.values || [];
}

export function parseSheetData(values) {
  if (!values || values.length < 2) return { headers: [], rows: [] };
  const headers = values[0].map(h => (h ?? '').toString().trim());
  const rows = values.slice(1).map((row, idx) => {
    const obj = { _rowIndex: idx + 2 };
    headers.forEach((h, i) => { obj[h] = (row[i] ?? '').toString().trim(); });
    return obj;
  });
  return { headers, rows };
}

export function colIndexToLetter(n) {
  let result = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

export function colLetterFromHeaders(headers, columnName) {
  const idx = headers.indexOf(columnName.trim());
  if (idx === -1) return null;
  return colIndexToLetter(idx + 1);
}

export async function writeCellValues(sheetId, tab, cells, accessToken) {
  const requests = cells.map(({ colLetter, rowIndex, value }) => ({
    range: `${tab}!${colLetter}${rowIndex}`,
    values: [[value]],
  }));
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data: requests }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Failed to write to sheet');
  }
  return res.json();
}

export async function batchUpdateValues(sheetId, data, accessToken, valueInputOption = 'USER_ENTERED') {
  if (!data.length) return null
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption, data }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message || 'Failed to write to sheet')
  }
  return res.json()
}

const LOG_HEADERS = ['Date & Time', 'Sent By', 'Mode', 'Batch', 'Subject', 'Message Body', 'Recipients Count', 'Channel']

export async function appendLogRow(sheetId, row, accessToken) {
  console.log('[MessageLog] Writing to sheet:', sheetId, '| Row:', row)
  const checkRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!checkRes.ok) {
    const err = await checkRes.json()
    console.error('[MessageLog] Header check failed:', checkRes.status, err)
    throw new Error(err.error?.message || 'Failed to check message log sheet')
  }
  const checkData = await checkRes.json()
  const hasHeader = checkData.values && checkData.values.length > 0
  console.log('[MessageLog] Has header row:', hasHeader)
  const values = hasHeader ? [row] : [LOG_HEADERS, row]

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    }
  )
  if (!res.ok) {
    const err = await res.json()
    console.error('[MessageLog] Write failed:', err)
    throw new Error(err.error?.message || 'Failed to write to message log')
  }
  console.log('[MessageLog] Write successful')
}

export async function getSheetTabIds(sheetId, accessToken) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message || 'Failed to get sheet metadata')
  }
  const data = await res.json()
  const map = {}
  data.sheets.forEach(s => { map[s.properties.title] = s.properties.sheetId })
  return map
}

export async function appendRows(sheetId, tab, rows, accessToken) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${tab}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message || 'Failed to append rows')
  }
}

export async function highlightRows(sheetId, tabNumericId, rowIndices, accessToken) {
  if (!rowIndices.length) return
  const requests = rowIndices.map(rowIndex => ({
    repeatCell: {
      range: {
        sheetId: tabNumericId,
        startRowIndex: rowIndex - 1,
        endRowIndex: rowIndex,
      },
      cell: {
        userEnteredFormat: { backgroundColor: { red: 1, green: 0.8, blue: 0.8 } }
      },
      fields: 'userEnteredFormat.backgroundColor',
    }
  }))
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    }
  )
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message || 'Failed to highlight rows')
  }
}

export async function deleteRows(sheetId, tabNumericId, rowIndices, accessToken) {
  if (!rowIndices.length) return
  // Sort descending so each delete doesn't shift the indices of subsequent ones.
  const sorted = [...new Set(rowIndices)].sort((a, b) => b - a)
  const requests = sorted.map(rowIndex => ({
    deleteDimension: {
      range: {
        sheetId: tabNumericId,
        dimension: 'ROWS',
        startIndex: rowIndex - 1,
        endIndex: rowIndex,
      },
    },
  }))
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    }
  )
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message || 'Failed to delete rows')
  }
}

export async function writeStatusColumn(sheetId, tab, rows, statusMap, headers, accessToken, columnName = 'Status') {
  const colLetter = colLetterFromHeaders(headers, columnName);
  if (!colLetter) throw new Error(`No "${columnName}" column found in ${tab}`);
  const cells = rows.map(row => ({
    colLetter,
    rowIndex: row._rowIndex,
    value: statusMap[row._rowIndex] ?? row[columnName],
  }));
  return writeCellValues(sheetId, tab, cells, accessToken);
}
