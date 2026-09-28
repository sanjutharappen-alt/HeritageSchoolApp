const BATCH_ORDER = [
  'LKG A', 'LKG B', 'UKG A', 'UKG B',
  '1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B',
  '5A', '5B', '6A', '6B', '7A', '7B', '8A', '8B',
  '9A', '9B', '10A', '10B', '11A', '11B',
  '11 Science', '11 Commerce', '11 Humanities',
  '12A', '12B', '12 Science', '12 Commerce', '12 Humanities',
]

export function sortBatches(batchesInData) {
  const set = new Set(batchesInData)
  const ordered = BATCH_ORDER.filter(b => set.has(b))
  const remainder = batchesInData.filter(b => !BATCH_ORDER.includes(b)).sort()
  return [...ordered, ...remainder]
}
