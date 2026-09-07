// Parses a pasted "your box" summary (e.g. from simmereats.com/client) into meal names.
// Expected repeating pattern per meal, concatenated with no separator:
//   "<name>x1<calories> kcal / <protein>g Protein"
const MEAL_PATTERN = /(.+?)x1\s*\d+\s*kcal\s*\/\s*[\d.]+g\s*Protein/g

export function parseBoxPaste(rawText) {
  const cleaned = rawText.replace(/^\s*YOUR BOX\s*/i, '').trim()
  const names = []
  let match
  while ((match = MEAL_PATTERN.exec(cleaned)) !== null) {
    const name = match[1].trim()
    if (name) names.push(name)
  }
  return names
}
