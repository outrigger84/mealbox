// Parses a pasted "your box" summary (e.g. from simmereats.com/client) into meal names.
// Expected repeating pattern per meal — name, then a quantity marker, then macros:
//   "<name>x1<calories> kcal / <protein>g Protein"
// The site sometimes puts these on separate lines when copied, so whitespace
// (including newlines, via the 's' flag on '.') between every token is tolerated.
const MEAL_PATTERN = /(.+?)\s*x\s*1\s*\d+\s*kcal\s*\/\s*[\d.]+\s*g\s*Protein/gis

export function parseBoxPaste(rawText) {
  const cleaned = rawText.replace(/^\s*YOUR BOX\s*/i, '').trim()
  const names = []
  let match
  while ((match = MEAL_PATTERN.exec(cleaned)) !== null) {
    const name = match[1].replace(/\s+/g, ' ').trim()
    if (name) names.push(name)
  }
  return names
}
