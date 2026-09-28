// Maps raw API errors to user-friendly messages. Keep messages short and
// actionable — staff are not engineers.

const NETWORK = /Failed to fetch|NetworkError|network/i
const AUTH = /UNAUTHENTICATED|invalid.*credenti|access token|401|403|permission/i
const QUOTA = /Quota exceeded|RESOURCE_EXHAUSTED|rate.?limit/i

export function isAuthError(e) {
  return AUTH.test(e?.message || '')
}

export function friendlySheetsError(e) {
  const msg = e?.message || ''
  if (AUTH.test(msg)) return 'Google session expired or access was revoked — please reconnect.'
  if (/Unable to parse range/i.test(msg)) return 'Sheet tab not found. Check the tab name matches what the app expects.'
  if (/Requested entity was not found/i.test(msg)) return 'Sheet not found — verify the Sheet ID in Settings.'
  if (QUOTA.test(msg)) return 'Too many requests to Google Sheets — wait a moment and try again.'
  if (NETWORK.test(msg)) return 'Network error reaching Google Sheets. Check your connection.'
  return 'Could not read or write the Google Sheet. Please try again.'
}

export function friendlyGmailError(e) {
  const msg = e?.message || ''
  if (AUTH.test(msg)) return 'Google session expired — please reconnect.'
  if (QUOTA.test(msg)) return 'Gmail rate limit reached. Wait a minute and try again.'
  if (NETWORK.test(msg)) return 'Network error reaching Gmail. Check your connection.'
  return 'Gmail draft creation failed. Please try again.'
}

export function friendlyAnthropicError(e) {
  const msg = e?.message || ''
  if (/invalid.*api.?key|authentication/i.test(msg)) return 'Anthropic API key is invalid — update it in Settings.'
  if (QUOTA.test(msg)) return 'Anthropic rate limit — wait a moment and try again.'
  if (/credit|billing/i.test(msg)) return 'Anthropic account issue — check billing on console.anthropic.com.'
  if (NETWORK.test(msg)) return 'Network error reaching Anthropic. Check your connection.'
  return 'AI generation failed. Please try again or simplify the request.'
}

export function friendlyTtsError(e) {
  const msg = e?.message || ''
  if (AUTH.test(msg)) return 'Voice service requires a fresh Google login — please reconnect.'
  if (QUOTA.test(msg)) return 'Voice generation quota exceeded — try again later.'
  if (NETWORK.test(msg)) return 'Network error reaching the voice service. Check your connection.'
  return 'Voice generation failed. Please try again.'
}
