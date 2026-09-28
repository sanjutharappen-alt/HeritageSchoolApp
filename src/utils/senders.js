export const SENDERS = [
  { label: 'The Heritage School Administration', value: 'The Heritage School Administration' },
  { label: 'Principal, The Heritage School',     value: 'Principal,\nThe Heritage School' },
  { label: 'Accounts Department, The Heritage School', value: 'Accounts Department,\nThe Heritage School' },
  { label: 'The Heritage School',                value: 'The Heritage School' },
]

export const DEFAULT_SENDER_LABEL = SENDERS[0].label

export function getSenderValue(label) {
  return SENDERS.find(s => s.label === label)?.value ?? label
}
