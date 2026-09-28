// Encode a subject string as an RFC 2047 encoded word so non-ASCII characters
// (em dash, Malayalam, etc.) survive unchanged through all email clients.
function encodeSubjectRfc2047(str) {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  bytes.forEach(b => { binary += String.fromCharCode(b) })
  return `=?UTF-8?B?${btoa(binary)}?=`
}

// Convert the full RFC 2822 message string to UTF-8 bytes, then base64url-encode.
// Using TextEncoder (not btoa+unescape) guarantees correct UTF-8 byte output.
function base64UrlEncodeMessage(message) {
  const bytes = new TextEncoder().encode(message)
  let binary = ''
  bytes.forEach(b => { binary += String.fromCharCode(b) })
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function buildRfc2822(to, subject, body) {
  return [
    `To: ${to}`,
    `Subject: ${encodeSubjectRfc2047(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ].join('\r\n')
}

export async function createGmailDraft(to, subject, body, accessToken) {
  const raw = base64UrlEncodeMessage(buildRfc2822(to, subject, body))
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw } }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message || `Gmail API error ${res.status}`)
  }
  return res.json()
}
